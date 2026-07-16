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
  if (contextExport !== undefined && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contextExport)) {
    throw new Error(`contextExport '${contextExport}' must be a valid identifier`)
  }
  const mounts = Object.entries(options.mounts ?? {}).map(([prefix, exportName]) => {
    if (!prefix.startsWith('/')) throw new Error(`Mount prefix must start with '/': '${prefix}'`)
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
      throw new Error(`Mount export '${exportName}' must be a valid identifier`)
    }
    return [prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix, exportName] as const
  })

  const used = {
    coercePrimitive: false,
    buildQueryObject: false,
    decodeSegment: false,
    validate: false,
    validateGuard: false,
    codePoints: false,
    compileRx: false,
  }

  const declarations: string[] = []
  for (const route of routes) {
    declarations.push(...emitRouteDeclarations(route, used, contextExport))
  }

  const statuses = new Set<number>([400, 404, 500])
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
    used.buildQueryObject ? 'buildQueryObject' : undefined,
    used.coercePrimitive ? 'coercePrimitive' : undefined,
    routes.some((route) => !route.isStatic) ? 'decodeSegment' : undefined,
  ].filter((name) => name !== undefined)
  const validatorImports = [
    used.validate ? 'validate' : undefined,
    used.validateGuard ? 'validateGuard' : undefined,
  ].filter((name) => name !== undefined)

  const routeModuleImports = [
    ...routes.map((route) => route.name),
    ...(contextExport === undefined ? [] : [contextExport]),
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
    'const notFound = () => new Response(\'{"error":"not_found"}\', initFor(404))',
    'const internalError = () => new Response(\'{"error":"internal_error"}\', initFor(500))',
    'const invalidJson = () => new Response(\'{"error":"invalid_json"}\', initFor(400))',
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
  if (used.validate) {
    lines.push(
      'const failValidation = (source, collect, value) => {',
      '  const result = collect()(value)',
      "  return new Response(JSON.stringify({ error: 'validation_failed', source, errors: result === true ? [] : result.errors }), initFor(400))",
      '}',
    )
  }
  if (openApiJson !== undefined) {
    lines.push(`const OPENAPI_JSON = ${JSON.stringify(openApiJson)}`)
  }
  lines.push('', ...declarations)
  lines.push(...emitDispatch(routes, openApiPath, contextExport, mounts))
  lines.push('', 'export default { fetch }', '')
  return lines.join('\n')
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
  contextExport: string | undefined,
): string[] => {
  const lines: string[] = []
  const request = route.contract.request

  for (const slot of ['params', 'query', 'body'] as const) {
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
  }

  const serialized: number[] = []
  for (const [status, response] of Object.entries(route.contract.responses)) {
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
  lines.push(
    `const respond_${route.name} = (reply) => {`,
    `  const body = ${bodyExpression}reply.body === undefined ? null : JSON.stringify(reply.body)`,
    '  if (reply.headers === undefined) {',
    '    return body === null ? new Response(null, { status: reply.status }) : new Response(body, initFor(reply.status))',
    '  }',
    '  return body === null',
    '    ? new Response(null, { status: reply.status, headers: { ...reply.headers } })',
    '    : new Response(body, { status: reply.status, headers: { ...JSON_HEADERS, ...reply.headers } })',
    '}',
  )

  lines.push(...emitRouteFunction(route, used, contextExport), '')
  return lines
}

const slotSuffix = (slot: 'params' | 'query' | 'body', name: string): string =>
  slot.charAt(0).toUpperCase() + slot.slice(1) + '_' + name

/**
 * Emits the route function itself: coerce + guard the declared slots in the
 * same order as the runtime pipeline (params, query, then body), build the
 * context, call the untouched user handler, and map the reply.
 */
const emitRouteFunction = (
  route: CompiledEntry,
  used: Record<string, boolean>,
  contextExport: string | undefined,
): string[] => {
  const request = route.contract.request
  const lines: string[] = []
  const parameters = [
    'request',
    'url',
    'rawPath',
    'queryIndex',
    ...(contextExport === undefined ? [] : ['env', 'executionContext']),
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
      `  if (!guard${suffix}(params)) return failValidation('params', collect${suffix}, params)`,
    )
    paramsValue = 'params'
  }

  let queryValue = 'undefined'
  if (request?.query !== undefined) {
    const suffix = slotSuffix('query', route.name)
    lines.push(
      `  const query = buildQueryObject(new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)), coercions${suffix})`,
      `  if (!guard${suffix}(query)) return failValidation('query', collect${suffix}, query)`,
    )
    queryValue = 'query'
  }

  const invokeLines = (bodyValue: string, appContextValue: string, indent: string): string[] => [
    `${indent}const context = { params: ${paramsValue}, query: ${queryValue}, body: ${bodyValue}, context: ${appContextValue}, request: apiRequest }`,
    `${indent}try {`,
    `${indent}  const reply = ${route.name}.handler(context)`,
    `${indent}  return typeof reply?.then === 'function' ? reply.then(respond_${route.name}, internalError) : respond_${route.name}(reply)`,
    `${indent}} catch {`,
    `${indent}  return internalError()`,
    `${indent}}`,
  ]

  const runLines = (bodyValue: string, indent: string): string[] => {
    const lines: string[] = [
      `${indent}const apiRequest = {`,
      `${indent}  method: request.method,`,
      `${indent}  path: rawPath,`,
      `${indent}  searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)),`,
      `${indent}  header: (name) => request.headers.get(name) ?? undefined,`,
      `${indent}  readBody: () => request.json(),`,
      `${indent}}`,
    ]
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
      `${indent}} catch {`,
      `${indent}  return internalError()`,
      `${indent}}`,
      `${indent}return typeof appContext?.then === 'function' ? appContext.then(proceed, internalError) : proceed(appContext)`,
    )
    return lines
  }

  if (request?.body !== undefined) {
    const suffix = slotSuffix('body', route.name)
    lines.push(
      '  return request.json().then((body) => {',
      `    if (!guard${suffix}(body)) return failValidation('body', collect${suffix}, body)`,
      ...runLines('body', '    '),
      '  }, invalidJson)',
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
 * the runtime router (static first, then registration order).
 */
const emitDispatch = (
  routes: readonly CompiledEntry[],
  openApiPath: string | undefined,
  contextExport: string | undefined,
  mounts: ReadonlyArray<readonly [prefix: string, exportName: string]>,
): string[] => {
  const extraArguments = contextExport === undefined ? '' : ', env, executionContext'
  const lines: string[] = [
    `export const fetch = (request${extraArguments}) => {`,
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
    lines.push('    return notFound()', '  }')
  }
  lines.push('  return notFound()', '}')
  return lines
}
