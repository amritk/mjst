import { buildCoercionPlan } from '../build-coercion-plan'
import { parsePathPattern } from '../parse-path-pattern'
import { toOpenApi } from '../to-open-api'
import type { AnyRouteContract, OpenApiInfo, PathSegment } from '../types'
import { generateGuardSource } from './generate-guard-source'
import { generateSerializerSource } from './generate-serializer-source'

/**
 * Options for {@link compileToModule}.
 */
export type CompileModuleOptions = {
  /**
   * Import specifier for the module that exports the route contracts. The keys
   * of `routes` must be that module's export names — the generated module
   * imports the contracts and calls their handlers, it never rewrites them.
   */
  readonly routesImport: string
  readonly routes: Readonly<Record<string, AnyRouteContract>>
  /** OpenAPI `info` block, embedded into the precomputed document. */
  readonly info?: OpenApiInfo
  /** Where the precomputed OpenAPI JSON is served. `false` disables. */
  readonly openApiPath?: string | false
  /**
   * Export name (in the routes module) of the app-context factory — the same
   * function passed to `createApi({ context })` in development. When set, the
   * emitted `fetch` accepts `(request, env, executionContext)` and runs the
   * factory after validation, exactly like the runtime engine.
   */
  readonly contextExport?: string
  /**
   * Prefix-mounted sub-handlers, as `{ '/api/auth': 'authHandler' }` where the
   * value is an export name (in the routes module) of a
   * `(request: Request) => Response | Promise<Response>` function. Checked
   * before routing with the raw Request passed straight through — the
   * compiled equivalent of `toFetchHandler`'s `mounts` option.
   */
  readonly mounts?: Readonly<Record<string, string>>
  /**
   * Export names (in the routes module) of `FetchOnRequest` gates, run in
   * order before mounts and routing — the compiled equivalent of
   * `toFetchHandler`'s `onRequest` option. A gate returning a `Response`
   * short-circuits the request; the response still flows through the
   * `onResponseExports` hooks.
   */
  readonly onRequestExports?: readonly string[]
  /**
   * Export names (in the routes module) of `FetchOnResponse` decorators, run
   * in order on every outgoing response — the compiled equivalent of
   * `toFetchHandler`'s `onResponse` option.
   */
  readonly onResponseExports?: readonly string[]
  /**
   * Export name (in the routes module) of the `ErrorFormatters` object — the
   * same value passed to `createApi({ errors })` in development, so both
   * engines shape their cold-path responses identically.
   */
  readonly errorsExport?: string
  /**
   * Export name (in the routes module) of the `onError` handler — the same
   * function passed to `createApi({ onError })` in development. It receives
   * `(error, apiRequest, { route, env, executionContext })`, which is what
   * error reporting (`createSentry`) needs in production.
   */
  readonly onErrorExport?: string
  /**
   * Rejects request bodies larger than this many bytes with a 413 — the
   * compiled equivalent of `toFetchHandler`'s `maxBodyBytes` option, enforced
   * with the same shared capped reader.
   */
  readonly maxBodyBytes?: number
  /** Import specifier for the @amritk/api helpers (override for tests/vendoring). */
  readonly runtimeImport?: string
  /** Import specifier for @amritk/runtime-validators (override for tests/vendoring). */
  readonly validatorsImport?: string
}

/**
 * Emits a fused fetch-handler module — the production counterpart to
 * `createApi`. Everything the runtime engine decides per request is decided
 * here, once, at build time: the router becomes a chain of string compares,
 * guards and coercions are inlined from the schemas (falling back to the
 * runtime interpreter outside the provably-identical subset), response bodies
 * get schema-derived serializers where safe, and the OpenAPI document is
 * embedded as a precomputed JSON string.
 *
 * The output is plain source — no `eval`, no `new Function` — so it runs on
 * Cloudflare Workers and under strict CSP exactly as benchmarked. The intended
 * workflow: serve `toFetchHandler(createApi({ routes }))` in development
 * (instant, no build step, response validation available) and the emitted
 * module in production; both engines answer every request identically, which
 * the differential test in this directory enforces.
 */
export const compileToModule = (options: CompileModuleOptions): string => {
  const runtimeImport = options.runtimeImport ?? '@amritk/api'
  const validatorsImport = options.validatorsImport ?? '@amritk/runtime-validators'
  const routes = Object.entries(options.routes).map(([name, contract]) => compileEntry(name, contract))
  assertNoDuplicates(routes)

  const contextExport = options.contextExport
  assertIdentifier(contextExport, 'contextExport')
  const errorsExport = options.errorsExport
  assertIdentifier(errorsExport, 'errorsExport')
  const onErrorExport = options.onErrorExport
  assertIdentifier(onErrorExport, 'onErrorExport')
  const onRequestExports = options.onRequestExports ?? []
  const onResponseExports = options.onResponseExports ?? []
  for (const name of [...onRequestExports, ...onResponseExports]) assertIdentifier(name, 'hook export')
  const maxBodyBytes = options.maxBodyBytes
  // The onError contract includes env/executionContext, so route functions
  // must thread the platform arguments even without an app context factory.
  const emitContext: EmitContext = {
    contextExport,
    needsPlatform: contextExport !== undefined || onErrorExport !== undefined,
  }

  const mounts = Object.entries(options.mounts ?? {}).map(([prefix, exportName]) => {
    if (!prefix.startsWith('/')) throw new Error(`Mount prefix must start with '/': '${prefix}'`)
    assertIdentifier(exportName, 'Mount export')
    return [prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix, exportName] as const
  })

  const used = {
    coercePrimitive: false,
    buildQueryObject: false,
    buildCookiesObject: false,
    decodeSegment: false,
    validate: false,
    validateGuard: false,
    codePoints: false,
    compileRx: false,
  }

  const declarations: string[] = []
  for (const route of routes) {
    declarations.push(...emitRouteDeclarations(route, used, emitContext))
  }

  const statuses = new Set<number>([400, 404, 413, 500])
  for (const route of routes) {
    for (const status of Object.keys(route.contract.responses)) statuses.add(Number(status))
  }

  const openApiPath = options.openApiPath === false ? undefined : (options.openApiPath ?? '/openapi.json')
  const info = options.info ?? { title: 'API', version: '0.0.0' }
  const openApiJson =
    openApiPath === undefined
      ? undefined
      : JSON.stringify(
          toOpenApi(
            routes.map((route) => route.contract),
            info,
          ),
        )

  const helperImports = [
    used.buildQueryObject ? 'buildQueryObjectFromString' : undefined,
    used.buildCookiesObject ? 'buildCookiesObject' : undefined,
    used.coercePrimitive ? 'coercePrimitive' : undefined,
    routes.some((route) => !route.isStatic) ? 'decodeSegment' : undefined,
    // The thrown-error path always distinguishes 413s, matching the runtime
    // pipeline for handlers that read (or reject on) an oversized body.
    'isPayloadTooLargeError',
    maxBodyBytes === undefined ? undefined : 'readBytesCapped',
  ].filter((name) => name !== undefined)
  const validatorImports = [
    used.validate ? 'validate' : undefined,
    used.validateGuard ? 'validateGuard' : undefined,
  ].filter((name) => name !== undefined)

  const routeModuleImports = [
    ...routes.map((route) => route.name),
    ...(contextExport === undefined ? [] : [contextExport]),
    ...(errorsExport === undefined ? [] : [errorsExport]),
    ...(onErrorExport === undefined ? [] : [onErrorExport]),
    ...onRequestExports,
    ...onResponseExports,
    ...mounts.map(([, exportName]) => exportName),
  ]
  const lines: string[] = [
    '// Generated by @amritk/api compileToModule. Do not edit.',
    '// @ts-nocheck — generated code is exercised by the differential test, not the type checker.',
    `import { ${[...new Set(routeModuleImports)].join(', ')} } from ${JSON.stringify(options.routesImport)}`,
  ]
  if (helperImports.length > 0) {
    lines.push(`import { ${helperImports.join(', ')} } from ${JSON.stringify(runtimeImport)}`)
  }
  if (validatorImports.length > 0) {
    lines.push(`import { ${validatorImports.join(', ')} } from ${JSON.stringify(validatorsImport)}`)
  }
  lines.push(
    '',
    "const JSON_HEADERS = { 'content-type': 'application/json' }",
    `const INITS = new Map([${[...statuses]
      .sort((a, b) => a - b)
      .map((status) => `[${status}, { status: ${status}, headers: JSON_HEADERS }]`)
      .join(', ')}])`,
    'const initFor = (status) => INITS.get(status) ?? { status, headers: JSON_HEADERS }',
  )

  // The framework-neutral request the app context factory, handlers, and
  // error formatters see. Body readers are built once here so the byte-limit
  // behavior matches toFetchHandler exactly.
  if (maxBodyBytes !== undefined) {
    lines.push(
      'const DECODER = new TextDecoder()',
      `const readTextCapped = (request) => readBytesCapped(request.body, request.headers.get('content-length'), ${maxBodyBytes}).then((bytes) => DECODER.decode(bytes))`,
    )
  }
  const readBodyExpression =
    maxBodyBytes === undefined ? 'request.json()' : 'readTextCapped(request).then((text) => JSON.parse(text))'
  lines.push(
    'const makeApiRequest = (request, url, rawPath, queryIndex) => ({',
    '  method: request.method,',
    '  path: rawPath,',
    "  searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)),",
    "  queryString: () => (queryIndex === -1 ? '' : url.slice(queryIndex + 1)),",
    '  header: (name) => request.headers.get(name) ?? undefined,',
    `  readBody: () => ${readBodyExpression},`,
    maxBodyBytes === undefined ? '  readText: () => request.text(),' : '  readText: () => readTextCapped(request),',
    maxBodyBytes === undefined
      ? '  readBytes: () => request.arrayBuffer().then((buffer) => new Uint8Array(buffer)),'
      : `  readBytes: () => readBytesCapped(request.body, request.headers.get('content-length'), ${maxBodyBytes}),`,
    '  signal: request.signal,',
    '})',
  )

  if (used.codePoints) {
    // Mirrors the interpreter's codePointLength: JSON Schema string lengths
    // count Unicode code points, not UTF-16 units.
    lines.push(
      'const codePoints = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { n++; const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i++ } } return n }',
    )
  }
  if (used.compileRx) {
    // Mirrors the interpreter's pattern compilation: Unicode mode first, with
    // a non-Unicode fallback for legacy patterns the u flag rejects.
    lines.push("const compileRx = (src) => { try { return new RegExp(src, 'u') } catch { return new RegExp(src) } }")
  }
  lines.push(...emitErrorHelpers(errorsExport, onErrorExport, used))
  if (openApiJson !== undefined) {
    lines.push(`const OPENAPI_JSON = ${JSON.stringify(openApiJson)}`)
  }
  lines.push('', ...declarations)
  lines.push(...emitDispatch(routes, openApiPath, emitContext, mounts, onRequestExports, onResponseExports))
  lines.push('', 'export default { fetch }', '')
  return lines.join('\n')
}

const assertIdentifier = (name: string | undefined, label: string): void => {
  if (name !== undefined && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`${label} '${name}' must be a valid identifier`)
  }
}

/**
 * Emits the cold-path response builders. With an `errorsExport` each one
 * consults the app's formatter first (building the same `ApiRequest` the
 * runtime pipeline would hand it); without one they collapse to the shared
 * frozen defaults. Call sites always pass the request context — the default
 * builders simply ignore it, which keeps every call site identical.
 */
const emitErrorHelpers = (
  errorsExport: string | undefined,
  onErrorExport: string | undefined,
  used: Record<string, boolean>,
): string[] => {
  const lines: string[] = []
  if (errorsExport !== undefined || onErrorExport !== undefined) {
    lines.push(
      // Mirrors the fetch adapter's ApiResponse → Response translation so a
      // formatter's reply (headers, raw contentType and all) serializes the
      // same way in both engines.
      'const toResponse = (r) => {',
      '  if (r.contentType !== undefined) {',
      "    return new Response(r.body ?? null, { status: r.status, headers: { 'content-type': r.contentType, ...r.headers } })",
      '  }',
      '  if (r.headers === undefined) {',
      '    return r.body === undefined ? new Response(null, { status: r.status }) : new Response(JSON.stringify(r.body), initFor(r.status))',
      '  }',
      '  return r.body === undefined',
      '    ? new Response(null, { status: r.status, headers: { ...r.headers } })',
      '    : new Response(JSON.stringify(r.body), { status: r.status, headers: { ...JSON_HEADERS, ...r.headers } })',
      '}',
    )
  }
  lines.push('const internalError = () => new Response(\'{"error":"internal_error"}\', initFor(500))')
  // The default 405 merges the allow header into the standard JSON headers —
  // exactly what the fetch adapter does with the runtime pipeline's reply.
  const defaultMethodNotAllowed =
    'new Response(\'{"error":"method_not_allowed"}\', { status: 405, headers: { ...JSON_HEADERS, allow: allow.join(\', \') } })'
  if (errorsExport === undefined) {
    lines.push(
      'const notFound = () => new Response(\'{"error":"not_found"}\', initFor(404))',
      'const invalidJson = () => new Response(\'{"error":"invalid_json"}\', initFor(400))',
      'const payloadTooLarge = () => new Response(\'{"error":"payload_too_large"}\', initFor(413))',
      `const methodNotAllowed = (allow) => ${defaultMethodNotAllowed}`,
    )
  } else {
    lines.push(
      `const notFound = (request, url, rawPath, queryIndex) => ${errorsExport}.notFound !== undefined ? toResponse(${errorsExport}.notFound(makeApiRequest(request, url, rawPath, queryIndex))) : new Response('{"error":"not_found"}', initFor(404))`,
      `const invalidJson = (request, url, rawPath, queryIndex) => ${errorsExport}.invalidJson !== undefined ? toResponse(${errorsExport}.invalidJson(makeApiRequest(request, url, rawPath, queryIndex))) : new Response('{"error":"invalid_json"}', initFor(400))`,
      `const payloadTooLarge = (request, url, rawPath, queryIndex) => ${errorsExport}.payloadTooLarge !== undefined ? toResponse(${errorsExport}.payloadTooLarge(makeApiRequest(request, url, rawPath, queryIndex))) : new Response('{"error":"payload_too_large"}', initFor(413))`,
      `const methodNotAllowed = (allow, request, url, rawPath, queryIndex) => ${errorsExport}.methodNotAllowed !== undefined ? toResponse(${errorsExport}.methodNotAllowed(allow, makeApiRequest(request, url, rawPath, queryIndex))) : ${defaultMethodNotAllowed}`,
    )
  }
  // The 413 check runs first in both variants: an oversized body is the
  // transport's outcome, not an application error to report.
  if (onErrorExport === undefined) {
    lines.push(
      'const thrown = (error, route, request, url, rawPath, queryIndex) => isPayloadTooLargeError(error) ? payloadTooLarge(request, url, rawPath, queryIndex) : internalError()',
    )
  } else {
    lines.push(
      'const thrown = (error, route, request, url, rawPath, queryIndex, env, executionContext) => isPayloadTooLargeError(error)',
      '  ? payloadTooLarge(request, url, rawPath, queryIndex)',
      `  : toResponse(${onErrorExport}(error, makeApiRequest(request, url, rawPath, queryIndex), { route, env, executionContext }))`,
    )
  }
  if (used['validate']) {
    if (errorsExport === undefined) {
      lines.push(
        'const failValidation = (source, collect, value) => {',
        '  const result = collect()(value)',
        "  return new Response(JSON.stringify({ error: 'validation_failed', source, errors: result === true ? [] : result.errors }), initFor(400))",
        '}',
      )
    } else {
      lines.push(
        'const failValidation = (source, collect, value, request, url, rawPath, queryIndex) => {',
        '  const result = collect()(value)',
        '  const errors = result === true ? [] : result.errors',
        `  if (${errorsExport}.validationFailed !== undefined) {`,
        `    return toResponse(${errorsExport}.validationFailed({ source, errors }, makeApiRequest(request, url, rawPath, queryIndex)))`,
        '  }',
        "  return new Response(JSON.stringify({ error: 'validation_failed', source, errors }), initFor(400))",
        '}',
      )
    }
  }
  return lines
}

/** Everything the emitter derives once per route. */
type CompiledEntry = {
  readonly name: string
  readonly contract: AnyRouteContract
  readonly method: string
  readonly segments: readonly PathSegment[]
  readonly isStatic: boolean
  readonly staticPath: string
  readonly paramNames: readonly string[]
}

const compileEntry = (name: string, contract: AnyRouteContract): CompiledEntry => {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Route key '${name}' must be a valid identifier (it becomes an import name)`)
  }
  const segments = parsePathPattern(contract.path)
  const isStatic = segments.every((segment) => typeof segment === 'string')
  return {
    name,
    contract,
    method: contract.method.toUpperCase(),
    segments,
    isStatic,
    staticPath: '/' + segments.map((segment) => (typeof segment === 'string' ? segment : '{}')).join('/'),
    paramNames: segments.flatMap((segment) => (typeof segment === 'string' ? [] : [segment.name])),
  }
}

const assertNoDuplicates = (routes: readonly CompiledEntry[]): void => {
  const seen = new Set<string>()
  for (const route of routes) {
    const key = route.method + ' ' + route.staticPath
    if (seen.has(key)) throw new Error(`Duplicate route: ${route.method} ${route.contract.path}`)
    seen.add(key)
  }
}

/**
 * Emits the per-route constants: schema literals, guards (inlined when the
 * schema fits the safe subset, interpreter-built otherwise), lazy error
 * collectors, query coercion maps, serializers, and the reply-to-Response
 * function. Mutates `used` so the module header only imports what appears.
 */
const emitRouteDeclarations = (
  route: CompiledEntry,
  used: Record<string, boolean>,
  emitContext: EmitContext,
): string[] => {
  const lines: string[] = []
  const request = route.contract.request

  for (const slot of ['params', 'query', 'headers', 'cookies', 'body'] as const) {
    const schema = request?.[slot]
    if (schema === undefined) continue
    const suffix = slotSuffix(slot, route.name)
    lines.push(`const schema${suffix} = ${JSON.stringify(schema)}`)
    const generated = generateGuardSource(schema, 'g' + suffix)
    if (generated === undefined) {
      used['validateGuard'] = true
      lines.push(`const guard${suffix} = validateGuard(schema${suffix})`)
    } else {
      used['codePoints'] = used['codePoints'] || generated.usesCodePoints
      used['compileRx'] = used['compileRx'] || generated.usesCompileRx
      lines.push(...generated.declarations)
      lines.push(`const guard${suffix} = ${generated.expression}`)
    }
    used['validate'] = true
    lines.push(
      `let _collect${suffix}`,
      `const collect${suffix} = () => (_collect${suffix} ??= validate(schema${suffix}))`,
    )
    if (slot === 'query') {
      used['buildQueryObject'] = true
      const plan = [...buildCoercionPlan(schema)]
      lines.push(`const coercions${suffix} = new Map(${JSON.stringify(plan.map(([key, kind]) => [key, kind]))})`)
    }
    if (slot === 'cookies') {
      used['buildCookiesObject'] = true
      const plan = [...buildCoercionPlan(schema)]
      const properties =
        typeof schema === 'object' && schema !== null ? (schema as { properties?: unknown }).properties : undefined
      const names = typeof properties === 'object' && properties !== null ? Object.keys(properties) : []
      lines.push(
        `const names${suffix} = new Set(${JSON.stringify(names)})`,
        `const coercions${suffix} = new Map(${JSON.stringify(plan.map(([key, kind]) => [key, kind]))})`,
      )
    }
  }

  const serialized: number[] = []
  const rawStatuses: Array<readonly [status: number, contentType: string]> = []
  for (const [status, response] of Object.entries(route.contract.responses)) {
    if (response.contentType !== undefined) {
      // Raw statuses skip serialization entirely — the body goes straight to
      // the Response constructor, streaming intact.
      rawStatuses.push([Number(status), response.contentType])
      continue
    }
    if (response.body === undefined) continue
    const source = generateSerializerSource(response.body)
    if (source !== undefined) {
      serialized.push(Number(status))
      lines.push(`const serialize_${route.name}_${status} = ${source}`)
    }
  }

  const bodyExpression = serialized
    .map((status) => `reply.status === ${status} ? serialize_${route.name}_${status}(reply.body) : `)
    .join('')
  lines.push(`const respond_${route.name} = (reply) => {`)
  for (const [status, contentType] of rawStatuses) {
    lines.push(
      `  if (reply.status === ${status}) return new Response(reply.body ?? null, { status: ${status}, headers: { 'content-type': ${JSON.stringify(contentType)}, ...reply.headers } })`,
    )
  }
  lines.push(
    `  const body = ${bodyExpression}reply.body === undefined ? null : JSON.stringify(reply.body)`,
    '  if (reply.headers === undefined) {',
    '    return body === null ? new Response(null, { status: reply.status }) : new Response(body, initFor(reply.status))',
    '  }',
    '  return body === null',
    '    ? new Response(null, { status: reply.status, headers: { ...reply.headers } })',
    '    : new Response(body, { status: reply.status, headers: { ...JSON_HEADERS, ...reply.headers } })',
    '}',
  )

  lines.push(...emitRouteFunction(route, used, emitContext), '')
  return lines
}

const slotSuffix = (slot: 'params' | 'query' | 'headers' | 'cookies' | 'body', name: string): string =>
  slot.charAt(0).toUpperCase() + slot.slice(1) + '_' + name

/** The request-context arguments every cold-path helper receives. */
const ERROR_ARGS = 'request, url, rawPath, queryIndex'

/**
 * What the emitters need to know about the module-wide wiring: the context
 * factory's export name, and whether route functions must accept the platform
 * `env`/`executionContext` arguments (required by the context factory and by
 * the onError contract alike).
 */
type EmitContext = {
  readonly contextExport: string | undefined
  readonly needsPlatform: boolean
}

/**
 * Emits the route function itself: coerce + guard the declared slots in the
 * same order as the runtime pipeline (params, query, headers, then body),
 * build the context, call the untouched user handler, and map the reply.
 */
const emitRouteFunction = (route: CompiledEntry, used: Record<string, boolean>, emitContext: EmitContext): string[] => {
  const { contextExport, needsPlatform } = emitContext
  // What thrown() receives: the imported contract (onError's grouping key)
  // plus the request context and, when threaded, the platform arguments.
  const thrownArguments = `${route.name}, ${ERROR_ARGS}${needsPlatform ? ', env, executionContext' : ''}`
  const request = route.contract.request
  const lines: string[] = []
  const parameters = [
    'request',
    'url',
    'rawPath',
    'queryIndex',
    ...(needsPlatform ? ['env', 'executionContext'] : []),
    ...route.paramNames.map((_, i) => 'p' + i),
  ]
  lines.push(`const route_${route.name} = (${parameters.join(', ')}) => {`)

  let paramsValue = 'undefined'
  if (request?.params !== undefined) {
    const plan = buildCoercionPlan(request.params)
    const fields = route.paramNames.map((name, index) => {
      const kind = plan.get(name)
      if (kind === 'number' || kind === 'boolean') {
        used['coercePrimitive'] = true
        return `${JSON.stringify(name)}: coercePrimitive(p${index}, '${kind}')`
      }
      return `${JSON.stringify(name)}: p${index}`
    })
    const suffix = slotSuffix('params', route.name)
    lines.push(
      `  const params = { ${fields.join(', ')} }`,
      `  if (!guard${suffix}(params)) return failValidation('params', collect${suffix}, params, ${ERROR_ARGS})`,
    )
    paramsValue = 'params'
  }

  let queryValue = 'undefined'
  if (request?.query !== undefined) {
    const suffix = slotSuffix('query', route.name)
    lines.push(
      `  const query = buildQueryObjectFromString(queryIndex === -1 ? '' : url.slice(queryIndex + 1), coercions${suffix})`,
      `  if (!guard${suffix}(query)) return failValidation('query', collect${suffix}, query, ${ERROR_ARGS})`,
    )
    queryValue = 'query'
  }

  let headersValue = 'undefined'
  if (request?.headers !== undefined) {
    const suffix = slotSuffix('headers', route.name)
    const schema = request.headers
    const plan = buildCoercionPlan(schema)
    const properties =
      typeof schema === 'object' && schema !== null ? (schema as { properties?: unknown }).properties : undefined
    const names = typeof properties === 'object' && properties !== null ? Object.keys(properties) : []
    // Headers are lookup-only on the transport, so the declared names are
    // unrolled here — one get per name, coerced per the startup plan, absent
    // headers omitted so `required` can reject them (same as the runtime's
    // buildHeadersObject).
    lines.push('  const headers = {}')
    names.forEach((name, index) => {
      const kind = plan.get(name)
      const valueExpression =
        kind === 'number' || kind === 'boolean' ? `coercePrimitive(h${index}, '${kind}')` : `h${index}`
      if (kind === 'number' || kind === 'boolean') used['coercePrimitive'] = true
      lines.push(
        `  const h${index} = request.headers.get(${JSON.stringify(name.toLowerCase())})`,
        `  if (h${index} !== null) headers[${JSON.stringify(name)}] = ${valueExpression}`,
      )
    })
    lines.push(
      `  if (!guard${suffix}(headers)) return failValidation('headers', collect${suffix}, headers, ${ERROR_ARGS})`,
    )
    headersValue = 'headers'
  }

  let cookiesValue = 'undefined'
  if (request?.cookies !== undefined) {
    const suffix = slotSuffix('cookies', route.name)
    lines.push(
      `  const cookies = buildCookiesObject(request.headers.get('cookie') ?? undefined, names${suffix}, coercions${suffix})`,
      `  if (!guard${suffix}(cookies)) return failValidation('cookies', collect${suffix}, cookies, ${ERROR_ARGS})`,
    )
    cookiesValue = 'cookies'
  }

  const invokeLines = (bodyValue: string, appContextValue: string, indent: string): string[] => [
    `${indent}const context = { params: ${paramsValue}, query: ${queryValue}, body: ${bodyValue}, headers: ${headersValue}, cookies: ${cookiesValue}, context: ${appContextValue}, request: apiRequest }`,
    `${indent}try {`,
    `${indent}  const reply = ${route.name}.handler(context)`,
    `${indent}  return typeof reply?.then === 'function' ? reply.then(respond_${route.name}, (error) => thrown(error, ${thrownArguments})) : respond_${route.name}(reply)`,
    `${indent}} catch (error) {`,
    `${indent}  return thrown(error, ${thrownArguments})`,
    `${indent}}`,
  ]

  const runLines = (bodyValue: string, indent: string): string[] => {
    const lines: string[] = []
    if (contextExport === undefined) {
      lines.push(...invokeLines(bodyValue, 'undefined', indent))
      return lines
    }
    // The factory runs after validation (mirroring the runtime pipeline) and
    // may be sync or async; a thrown or rejected factory becomes a 500, the
    // same path a throwing handler takes.
    lines.push(
      `${indent}const proceed = (appContext) => {`,
      ...invokeLines(bodyValue, 'appContext', indent + '  '),
      `${indent}}`,
      `${indent}let appContext`,
      `${indent}try {`,
      `${indent}  appContext = ${contextExport}({ request: apiRequest, env, executionContext })`,
      `${indent}} catch (error) {`,
      `${indent}  return thrown(error, ${thrownArguments})`,
      `${indent}}`,
      `${indent}return typeof appContext?.then === 'function' ? appContext.then(proceed, (error) => thrown(error, ${thrownArguments})) : proceed(appContext)`,
    )
    return lines
  }

  // The apiRequest is built after the zero-cost guards (params, query,
  // headers) so guard-rejected requests allocate nothing, and before the body
  // read so exactly one object owns the single-use body stream.
  lines.push(`  const apiRequest = makeApiRequest(${ERROR_ARGS})`)
  if (request?.body !== undefined) {
    const suffix = slotSuffix('body', route.name)
    lines.push(
      '  return apiRequest.readBody().then((body) => {',
      `    if (!guard${suffix}(body)) return failValidation('body', collect${suffix}, body, ${ERROR_ARGS})`,
      ...runLines('body', '    '),
      `  }, (error) => isPayloadTooLargeError(error) ? payloadTooLarge(${ERROR_ARGS}) : invalidJson(${ERROR_ARGS}))`,
    )
  } else {
    lines.push(...runLines('undefined', '  '))
  }
  lines.push('}')
  return lines
}

/**
 * Emits the exported fetch handler: path sliced from `request.url` without a
 * URL parse, the OpenAPI document answered from its precomputed string, then
 * per-method dispatch — static paths as direct compares, parameterized paths
 * as one split plus literal segment checks, in the same precedence order as
 * the runtime router (static first, then registration order). With hooks the
 * dispatch becomes an inner function wrapped by the gate/decorator chain,
 * mirroring `toFetchHandler`.
 */
const emitDispatch = (
  routes: readonly CompiledEntry[],
  openApiPath: string | undefined,
  emitContext: EmitContext,
  mounts: ReadonlyArray<readonly [prefix: string, exportName: string]>,
  onRequestExports: readonly string[],
  onResponseExports: readonly string[],
): string[] => {
  const hooked = onRequestExports.length > 0 || onResponseExports.length > 0
  const extraArguments = emitContext.needsPlatform ? ', env, executionContext' : ''
  const dispatchName = hooked ? 'handleFetch' : 'fetch'
  const lines: string[] = [
    `${hooked ? 'const' : 'export const'} ${dispatchName} = (request${extraArguments}) => {`,
    '  const url = request.url',
    "  const schemeEnd = url.indexOf('://')",
    "  const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)",
    "  const queryIndex = pathStart === -1 ? -1 : url.indexOf('?', pathStart)",
    "  const rawPath = pathStart === -1 ? '/' : queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex)",
    '  const method = request.method',
  ]
  for (const [prefix, exportName] of mounts) {
    lines.push(
      `  if (rawPath === ${JSON.stringify(prefix)} || rawPath.startsWith(${JSON.stringify(prefix + '/')})) return ${exportName}(request)`,
    )
  }
  if (openApiPath !== undefined) {
    lines.push(
      `  if (method === 'GET' && rawPath === ${JSON.stringify(openApiPath)}) return new Response(OPENAPI_JSON, initFor(200))`,
    )
  }
  lines.push("  const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath")

  const methods = [...new Set(routes.map((route) => route.method))]
  for (const method of methods) {
    const group = routes.filter((route) => route.method === method)
    const statics = group.filter((route) => route.isStatic)
    const dynamics = group.filter((route) => !route.isStatic)
    // No return at the end of the block: an unmatched method falls through to
    // the shared 405/404 tail below, like the runtime pipeline.
    lines.push(`  if (method === '${method}') {`)
    for (const route of statics) {
      lines.push(
        `    if (path === ${JSON.stringify(route.staticPath)}) return route_${route.name}(request, url, rawPath, queryIndex${extraArguments})`,
      )
    }
    if (dynamics.length > 0) {
      lines.push("    const segments = path === '/' ? [] : path.slice(1).split('/')")
      for (const route of dynamics) {
        const conditions = [`segments.length === ${route.segments.length}`]
        const captures: string[] = []
        route.segments.forEach((segment, index) => {
          if (typeof segment === 'string') {
            conditions.push(`segments[${index}] === ${JSON.stringify(segment)}`)
          } else {
            captures.push(`decodeSegment(segments[${index}])`)
          }
        })
        lines.push(
          `    if (${conditions.join(' && ')}) return route_${route.name}(request, url, rawPath, queryIndex${extraArguments}, ${captures.join(', ')})`,
        )
      }
    }
    lines.push('  }')
  }

  // The 405/404 tail. A request only gets here when its own method has no
  // matching route, so any method collected below is a genuine alternative.
  const staticAllow = new Map<string, string[]>()
  for (const route of routes.filter((entry) => entry.isStatic)) {
    const list = staticAllow.get(route.staticPath) ?? []
    list.push(route.method)
    staticAllow.set(route.staticPath, list)
  }
  const dynamics = routes.filter((entry) => !entry.isStatic)
  if (staticAllow.size > 0) {
    lines.unshift(`const ALLOW_STATIC = new Map(${JSON.stringify([...staticAllow.entries()])})`)
    lines.push('  const allow = [...(ALLOW_STATIC.get(path) ?? [])]')
  } else {
    lines.push('  const allow = []')
  }
  if (dynamics.length > 0) {
    lines.push("  const allowSegments = path === '/' ? [] : path.slice(1).split('/')")
    for (const route of dynamics) {
      const conditions = [`allowSegments.length === ${route.segments.length}`]
      route.segments.forEach((segment, index) => {
        if (typeof segment === 'string') {
          conditions.push(`allowSegments[${index}] === ${JSON.stringify(segment)}`)
        }
      })
      conditions.push(`!allow.includes('${route.method}')`)
      lines.push(`  if (${conditions.join(' && ')}) allow.push('${route.method}')`)
    }
  }
  lines.push(
    `  if (allow.length > 0) return methodNotAllowed(allow.sort(), ${ERROR_ARGS})`,
    `  return notFound(${ERROR_ARGS})`,
    '}',
  )

  if (!hooked) return lines

  // The hook wrapper: gates in order (first Response wins), then dispatch,
  // and every outcome — short-circuit, mount, routed reply, 404 — through the
  // decorators. Identical semantics to toFetchHandler's chains.
  if (onResponseExports.length > 0) {
    lines.push('const finishResponse = async (response, request) => {', '  let current = response', '  let next')
    for (const name of onResponseExports) {
      lines.push(`  next = await ${name}(current, request)`, '  if (next !== undefined) current = next')
    }
    lines.push('  return current', '}')
  }
  const finish = (expression: string): string =>
    onResponseExports.length > 0 ? `finishResponse(${expression}, request)` : expression
  lines.push('export const fetch = async (request, env, executionContext) => {')
  if (onRequestExports.length > 0) {
    lines.push('  let early')
    for (const name of onRequestExports) {
      lines.push(
        `  early = await ${name}(request, env, executionContext)`,
        `  if (early !== undefined) return ${finish('early')}`,
      )
    }
  }
  lines.push(
    `  return ${finish(`await handleFetch(request${emitContext.needsPlatform ? ', env, executionContext' : ''})`)}`,
    '}',
  )
  return lines
}
