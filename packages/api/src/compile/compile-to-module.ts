import type { ValidateOptions } from '@amritk/runtime-validators'

import { buildCoercionPlan } from '../build-coercion-plan'
import { fnv1aHex } from '../fnv1a-hex'
import { hashContracts } from '../hash-contracts'
import { parsePathPattern } from '../parse-path-pattern'
import { DEFAULT_MAX_BODY_BYTES } from '../payload-too-large'
import { assertRoutesSecured } from '../secure-routes'
import { HOOK_ERROR_MESSAGE } from '../to-fetch-handler'
import { toOpenApi } from '../to-open-api'
import type { AnyRouteContract, OpenApiExtras, OpenApiInfo, PathSegment } from '../types'
import { generateGuardSource } from './generate-guard-source'
import { generateSerializerSource } from './generate-serializer-source'

/**
 * Options for {@link compileToModule}.
 */
export type CompileModuleOptions = OpenApiExtras & {
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
   * Export names (in the routes module) of the guards gating the served
   * OpenAPI document — the same functions passed to
   * `createApi({ openApiGuards })` in development. The document endpoint is
   * answered before routing, so `secureRoutes` never reaches it and a
   * deny-by-default API would otherwise publish its schema to anyone. They run
   * exactly like a route's security guards (the context factory first, request
   * slots `undefined`, first denial winning) and a denial is sent as-is,
   * without response validation.
   */
  readonly openApiGuardExports?: readonly string[]
  /**
   * Export name (in the routes module) of the app-context factory — the same
   * function passed to `createApi({ context })` in development. When set, the
   * emitted `fetch` accepts `(request, env, executionContext)` and runs the
   * factory after validation, exactly like the runtime engine.
   */
  readonly contextExport?: string
  /**
   * Export name (in the routes module) of a `ValidatorCompiler` — the same
   * function passed to `createApi({ compile })` in development. When set, no
   * guards are inlined from the schemas: every request slot's guard and error
   * collector (and, with `validateResponses`, every reply validator) comes
   * from calling this compiler at module init, exactly like the runtime
   * engine builds its validators at startup. When unset, the emitter keeps
   * its default strategy — inline guards for the safe subset, the interpreter
   * elsewhere.
   */
  readonly compileExport?: string
  /**
   * String `format`s to enforce, exactly like `createApi({ formats })` — pass
   * the same value to both engines so the compiled module and the development
   * server agree. Off by default (JSON Schema treats `format` as an
   * annotation), so a `format: 'uuid'` param accepts any string until set.
   *
   * A schema carrying `format` then leaves the inlinable subset and is checked
   * by the interpreter, which owns the format regexes. Ignored when
   * `compileExport` is set, since that replaces the engine this configures.
   */
  readonly formats?: ValidateOptions['formats']
  /**
   * Validate reply bodies and declared reply headers against the response
   * contracts, exactly like `createApi({ validateResponses: true })`:
   * contract-breaking replies (and undeclared statuses) answer the same
   * `invalid_response` 500 the runtime engine produces. Validators are built
   * at module init — from `compileExport` when set, the interpreter
   * otherwise — and schema-derived fast serializers are skipped so bodies
   * serialize via JSON.stringify, matching the runtime's ordering and output.
   */
  readonly validateResponses?: boolean
  /**
   * Prefix-mounted sub-handlers, as `{ '/api/auth': 'authHandler' }` where the
   * value is an export name (in the routes module) of a
   * `(request: Request, env: unknown, executionContext: unknown) => Response |
   * Promise<Response>` function. Checked before routing with the raw Request —
   * and the platform `env`/`executionContext` — passed straight through, so an
   * env-dependent sub-router (Better Auth on Workers) works. The compiled
   * equivalent of `toFetchHandler`'s `mounts` option.
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
   * Export name (in the routes module) of the observe hook — the same
   * function passed to `createApi({ observe })` in development. Called once
   * per matched request with `{ route, request, status, durationMs, env,
   * executionContext }`; unmatched requests and the OpenAPI document are not
   * observed, and a thrown observer is swallowed. No wrapper code is emitted
   * when unset, so the hot path pays nothing.
   */
  readonly observeExport?: string
  /**
   * Export name (in the routes module) of the unmatched-request observer —
   * the same function passed to `createApi({ observeUnmatched })` in
   * development. Called once per 404/405 with `route: undefined`; no code is
   * emitted when unset.
   */
  readonly observeUnmatchedExport?: string
  /**
   * Rejects request bodies larger than this many bytes with a 413 — the
   * compiled equivalent of `toFetchHandler`'s `maxBodyBytes` option, enforced
   * with the same shared capped reader. Defaults to 1 MiB (1,048,576 bytes);
   * pass `Infinity` to disable the cap entirely.
   */
  readonly maxBodyBytes?: number
  /** Import specifier for the @amritk/api helpers (override for tests/vendoring). */
  readonly runtimeImport?: string
  /** Import specifier for @amritk/runtime-validators (override for tests/vendoring). */
  readonly validatorsImport?: string
}

/**
 * Name of the hoisted `ValidateOptions` constant in the emitted module. Only
 * declared when {@link CompileModuleOptions.formats} is set.
 */
const VALIDATE_OPTIONS_VAR = 'VALIDATE_OPTIONS'

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

  // Documented-but-unenforced authentication is the failure mode `secureRoutes`
  // exists to prevent, so a route the document says needs auth but that carries
  // no resolved guards fails the build rather than shipping an open endpoint —
  // the same check `createApi` runs at startup.
  assertRoutesSecured(
    routes.map((route) => route.contract),
    options.security,
    'compileToModule',
  )

  const contextExport = options.contextExport
  assertIdentifier(contextExport, 'contextExport')
  const compileExport = options.compileExport
  assertIdentifier(compileExport, 'compileExport')
  const validateResponses = options.validateResponses ?? false
  const errorsExport = options.errorsExport
  assertIdentifier(errorsExport, 'errorsExport')
  const onErrorExport = options.onErrorExport
  assertIdentifier(onErrorExport, 'onErrorExport')
  const observeExport = options.observeExport
  assertIdentifier(observeExport, 'observeExport')
  const observeUnmatchedExport = options.observeUnmatchedExport
  assertIdentifier(observeUnmatchedExport, 'observeUnmatchedExport')
  const onRequestExports = options.onRequestExports ?? []
  const onResponseExports = options.onResponseExports ?? []
  for (const name of [...onRequestExports, ...onResponseExports]) assertIdentifier(name, 'hook export')
  const openApiGuardExports = options.openApiGuardExports ?? []
  for (const name of openApiGuardExports) assertIdentifier(name, 'OpenAPI guard export')
  // Infinity (the explicit opt-out) reads as "no cap" below; the default cap
  // matches the runtime adapters so both engines cut off at the same byte.
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  // The cap is interpolated as a bare numeric literal, so a non-number (a
  // config file read without a schema, say) would land as raw source rather
  // than as a limit. Only a real byte count or the Infinity opt-out is emitted.
  if (typeof maxBodyBytes !== 'number' || Number.isNaN(maxBodyBytes) || maxBodyBytes < 0) {
    throw new Error(`maxBodyBytes must be a non-negative number or Infinity, received '${String(maxBodyBytes)}'`)
  }
  const unboundedBody = maxBodyBytes === Number.POSITIVE_INFINITY

  const mounts = Object.entries(options.mounts ?? {}).map(([prefix, exportName]) => {
    if (!prefix.startsWith('/')) throw new Error(`Mount prefix must start with '/': '${prefix}'`)
    assertIdentifier(exportName, 'Mount export')
    return [prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix, exportName] as const
  })

  // The onError and observe contracts include env/executionContext, mounts
  // receive them too (an env-dependent sub-router like Better Auth on Workers),
  // and the document gate hands them to the context factory it builds, so route
  // functions must thread the platform arguments even without a context factory.
  // One hoisted constant rather than an object literal per call site: the
  // interpreter memoizes prepared validators per (schema, options) pair, so a
  // fresh literal each time would defeat that cache.
  // Parsed rather than written as a literal, like every other baked constant —
  // see `jsonConstant`. Nothing here can be named `__proto__` today, but a
  // single rule ("contract data is parsed, never re-evaluated as source") is
  // the only version of this that stays true as the emitter grows.
  const validateOptions =
    options.formats === undefined ? undefined : jsonConstant({ formats: options.formats } satisfies ValidateOptions)

  const emitContext: EmitContext = {
    contextExport,
    validateOptions,
    needsPlatform:
      contextExport !== undefined ||
      onErrorExport !== undefined ||
      observeExport !== undefined ||
      observeUnmatchedExport !== undefined ||
      mounts.length > 0 ||
      openApiGuardExports.length > 0,
    compileExport,
    validateResponses,
  }

  const used = {
    coercePrimitive: false,
    buildQueryObject: false,
    buildCookiesObject: false,
    decodeSegment: false,
    validate: false,
    validateGuard: false,
    failValidation: false,
    codePoints: false,
    compileRx: false,
    matchesBodyType: false,
    parseFormBody: false,
    parseMultipartBody: false,
    invalidBody: false,
    unsupportedMediaType: false,
    refine: false,
    guards: false,
  }
  // The document gate runs its guards through the same shared loop a route's
  // do, so it has to exist even when no route declares a guard of its own.
  if (openApiGuardExports.length > 0) used.guards = true

  const declarations: string[] = []
  for (const route of routes) {
    declarations.push(...emitRouteDeclarations(route, used, emitContext))
  }

  const statuses = new Set<number>([400, 404, 413, 415, 500])
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
            {
              servers: options.servers,
              securitySchemes: options.securitySchemes,
              security: options.security,
              tags: options.tags,
            },
          ),
        )

  const helperImports = [
    used.buildQueryObject ? 'buildQueryObjectFromString' : undefined,
    used.buildCookiesObject ? 'buildCookiesObject' : undefined,
    used.coercePrimitive ? 'coercePrimitive' : undefined,
    used.matchesBodyType ? 'matchesBodyType' : undefined,
    used.parseFormBody ? 'parseFormBody' : undefined,
    used.parseMultipartBody ? 'parseMultipartBody' : undefined,
    used.refine ? 'refinementFailure' : undefined,
    routes.some((route) => !route.isStatic) ? 'decodeSegment' : undefined,
    // The thrown-error path always distinguishes 413s, matching the runtime
    // pipeline for handlers that read (or reject on) an oversized body.
    'isPayloadTooLargeError',
    // The staleness check below recomputes the contracts hash at init, so
    // every emitted module imports the hash function.
    'hashContracts',
    // Every respond function's custom-headers branch goes through the shared
    // header builder, so repeated set-cookie values serialize identically to
    // the runtime adapter.
    'buildResponseHeaders',
    unboundedBody ? undefined : 'readBodyCapped',
  ].filter((name) => name !== undefined)
  const validatorImports = [
    used.validate ? 'validate' : undefined,
    used.validateGuard ? 'validateGuard' : undefined,
  ].filter((name) => name !== undefined)

  const routeModuleImports = [
    ...routes.map((route) => route.name),
    ...(contextExport === undefined ? [] : [contextExport]),
    ...(compileExport === undefined ? [] : [compileExport]),
    ...(errorsExport === undefined ? [] : [errorsExport]),
    ...(onErrorExport === undefined ? [] : [onErrorExport]),
    ...(observeExport === undefined ? [] : [observeExport]),
    ...(observeUnmatchedExport === undefined ? [] : [observeUnmatchedExport]),
    ...onRequestExports,
    ...onResponseExports,
    ...openApiGuardExports,
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
  // The schemas are baked into this module but the handlers are imported
  // live, so a schema edit without regeneration silently drifts. The baked
  // hash against a recompute over the live contracts catches exactly that at
  // init — as a warning, never a throw: a stale module still serves traffic,
  // taking production down over it would be worse than the drift.
  const contractsHash = hashContracts(routes.map((route) => route.contract))
  const staleWarning = `[@amritk/api] Stale compiled module: the route contracts in ${options.routesImport} no longer match the schemas baked into this module — re-run compileToModule to regenerate it.`
  // Guards, security guards, and `refine` are *shaped in* at emit time: this
  // module only contains the code that runs them because the contracts had
  // them when it was generated. Adding one afterwards would leave a compiled
  // server that skips it, and removing one would leave a call into
  // `undefined`. Both are caught by the hash above now, but a warning is the
  // wrong answer for this particular delta: "serve anyway" for a schema edit
  // means slightly stale validation, while for a guard it means serving an
  // endpoint the app believes is authenticated. So the security-shaped delta
  // is separated out and fails the process at init — a deploy that dies
  // loudly beats one that quietly stops checking credentials. Everything else
  // keeps warning and keeps serving, exactly as before.
  const guardShapes = routes.map(
    (route) =>
      `${route.contract.guards?.length ?? 0}/${route.contract.securityGuards?.length ?? 0}/${route.contract.refine !== undefined ? 1 : 0}`,
  )
  const guardError = `[@amritk/api] Stale compiled module: the guards, security guards, or refine hooks in ${options.routesImport} no longer match the ones this module was generated against, so they would not be enforced — re-run compileToModule to regenerate it.`
  lines.push(
    '',
    `export const contractsHash = '${contractsHash}'`,
    `if (hashContracts([${routes.map((route) => route.name).join(', ')}]) !== contractsHash) {`,
    `  console.error(${JSON.stringify(staleWarning)})`,
    '}',
    `const guardShape = (route) => \`\${route.guards?.length ?? 0}/\${route.securityGuards?.length ?? 0}/\${route.refine !== undefined ? 1 : 0}\``,
    `if ([${routes.map((route) => route.name).join(', ')}].map(guardShape).join(',') !== ${JSON.stringify(guardShapes.join(','))}) {`,
    `  throw new Error(${JSON.stringify(guardError)})`,
    '}',
    '',
    "const JSON_HEADERS = { 'content-type': 'application/json' }",
    ...(validateOptions === undefined ? [] : [`const ${VALIDATE_OPTIONS_VAR} = ${validateOptions}`]),
    `const INITS = new Map([${[...statuses]
      .sort((a, b) => a - b)
      .map((status) => `[${status}, { status: ${status}, headers: JSON_HEADERS }]`)
      .join(', ')}])`,
    'const initFor = (status) => INITS.get(status) ?? { status, headers: JSON_HEADERS }',
  )

  // The framework-neutral request the app context factory, handlers, and
  // error formatters see. Body readers are built once here so the byte-limit
  // and read-caching behavior match toFetchHandler exactly: all three readers
  // share one buffered read, so the body can be read repeatedly and after the
  // pipeline consumed a declared body schema.
  const readAllBytesExpression = unboundedBody
    ? 'request.arrayBuffer().then((buffer) => new Uint8Array(buffer))'
    : `readBodyCapped(request, ${maxBodyBytes})`
  lines.push(
    'const DECODER = new TextDecoder()',
    // `locals` is the per-request bag created in the dispatch, so every
    // consumer of this request — gates, context factory, handler, error
    // formatters, observers — reads and writes the same object, exactly like
    // the runtime adapter's single ApiRequest.
    // `signal` is inherited rather than an own accessor. Reading
    // `Request.signal` eagerly is expensive on workerd (the first touch
    // materializes a host-backed AbortSignal), but an own accessor is
    // expensive too — it pushes the request object out of V8's in-object
    // slots, which measured as 852 to 1276 bytes allocated per request inside
    // workerd. On the prototype, instances stay plain data objects and the
    // lazy read is free. The runtime adapter's API_REQUEST_PROTO is the twin.
    'const API_REQUEST_PROTO = { get signal() { return this.raw.signal } }',
    'const makeApiRequest = (request, url, rawPath, queryIndex, locals) => {',
    '  let bytes',
    `  const readAllBytes = () => (bytes ??= ${readAllBytesExpression})`,
    '  return {',
    '    __proto__: API_REQUEST_PROTO,',
    '    method: request.method,',
    '    path: rawPath,',
    "    searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)),",
    "    queryString: () => (queryIndex === -1 ? '' : url.slice(queryIndex + 1)),",
    '    header: (name) => request.headers.get(name) ?? undefined,',
    '    readBody: () => readAllBytes().then((buffer) => JSON.parse(DECODER.decode(buffer))),',
    '    readText: () => readAllBytes().then((buffer) => DECODER.decode(buffer)),',
    '    readBytes: readAllBytes,',
    '    raw: request,',
    '    locals,',
    '  }',
    '}',
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
  if (used.guards) {
    // Runs a route's guards in order, first denial winning — the emitted twin
    // of the runtime pipeline's guard loop. Stays synchronous (no promise
    // allocated) until a guard actually returns one; when a guard is async it
    // resolves and recurses from the next index. `undefined` means "all passed".
    lines.push(
      'const runGuards = (guards, context, i) => {',
      '  while (i < guards.length) {',
      '    const result = guards[i++](context)',
      "    if (result != null && typeof result.then === 'function') {",
      '      return result.then((value) => (value !== undefined ? value : runGuards(guards, context, i)))',
      '    }',
      '    if (result !== undefined) return result',
      '  }',
      '  return undefined',
      '}',
    )
  }
  lines.push(...emitErrorHelpers(errorsExport, onErrorExport, used, openApiGuardExports.length > 0))
  if (validateResponses) {
    // The runtime's invalid_response 500 in emitted form: `result` is the
    // collector's verdict (true = no details, exactly like the pipeline's
    // `result === true ? [] : result.errors`), `source` is set only for the
    // reply-headers variant.
    lines.push(
      'const invalidResponse = (status, source, result) => {',
      '  const errors = result === true ? [] : result.errors',
      '  const body = source === undefined',
      "    ? { error: 'invalid_response', status, errors }",
      "    : { error: 'invalid_response', status, source, errors }",
      '  return new Response(JSON.stringify(body), initFor(500))',
      '}',
    )
  }
  if (openApiJson !== undefined) {
    // The etag is baked at build time from the same hash the runtime engine
    // applies at startup, so identical documents answer with identical etags
    // in both engines.
    const openApiEtag = '"' + fnv1aHex(openApiJson) + '"'
    lines.push(
      `const OPENAPI_JSON = ${JSON.stringify(openApiJson)}`,
      `const OPENAPI_ETAG = ${JSON.stringify(openApiEtag)}`,
      `const OPENAPI_HEADERS = { 'content-type': 'application/json', etag: OPENAPI_ETAG, 'cache-control': 'no-cache' }`,
      `const OPENAPI_304_HEADERS = { etag: OPENAPI_ETAG, 'cache-control': 'no-cache' }`,
      // Inline copy of the runtime's matchesIfNoneMatch (RFC 9110 weak
      // comparison as an exact-token scan) — the emitted module's runtime
      // imports are limited to the package's public surface.
      "const openApiEtagMatches = (value) => { if (value.trim() === '*') return true; for (const part of value.split(',')) { let candidate = part.trim(); if (candidate.startsWith('W/')) candidate = candidate.slice(2); if (candidate === OPENAPI_ETAG) return true } return false }",
    )
    if (openApiGuardExports.length > 0) lines.push(...emitOpenApiGate(openApiGuardExports, contextExport))
  }
  lines.push('', ...declarations)
  lines.push(
    ...emitDispatch(
      routes,
      openApiPath,
      emitContext,
      mounts,
      onRequestExports,
      onResponseExports,
      observeExport,
      observeUnmatchedExport,
      onErrorExport,
      openApiGuardExports.length > 0,
    ),
  )
  lines.push('', 'export default { fetch }', '')
  const source = lines.join('\n')
  assertNoImportCollision(source, [...new Set(routeModuleImports)])
  return source
}

/**
 * Fails the compile when an app export shares a name with one of the module's
 * own top-level bindings.
 *
 * The emitted module imports the app's exports unaliased and declares roughly
 * twenty internals of its own — `notFound`, `toResponse`, `observed`,
 * `stripHeadBody`, `internalError`, … — every one a plausible name for a route,
 * mount, or hook. A collision produces a module that declares the name twice,
 * so it fails to load with a `SyntaxError` naming an identifier the author
 * never wrote, from a file they did not author. Saying it here instead names
 * the export and the fix.
 *
 * The internal names are read back out of the emitted source rather than
 * listed, so the check cannot drift as the emitter grows — which a hand-kept
 * list of twenty names certainly would. That includes the *other* import
 * lines: the module also imports unaliased from the runtime and the validators,
 * so an app exporting `validate`, `toResponse` or `readBodyCapped` collides
 * there rather than with a declaration, and a check that only read
 * declarations would miss exactly those.
 */
const assertNoImportCollision = (source: string, imported: readonly string[]): void => {
  const declared = new Set<string>()
  for (const match of source.matchAll(/^(?:export )?(?:const|let|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
    declared.add(match[1] as string)
  }
  // Every *other* import line's bindings. The first is the routes module —
  // the names being checked — so it is skipped rather than reported against
  // itself.
  const importLines = [...source.matchAll(/^import \{ ([^}]*) \} from /gm)].slice(1)
  for (const line of importLines) {
    for (const binding of (line[1] as string).split(',')) {
      const name = binding
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (name !== undefined && name !== '') declared.add(name)
    }
  }
  const clashes = imported.filter((name) => declared.has(name))
  if (clashes.length === 0) return
  throw new Error(
    `compileToModule: ${clashes.map((name) => `'${name}'`).join(', ')} ` +
      `${clashes.length === 1 ? 'is' : 'are'} also declared by the generated module. ` +
      'Rename the export in the routes module (the generated file imports it unaliased, ' +
      'so the two names would collide and the module would not load).',
  )
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
 *
 * `needsToResponse` forces the reply → `Response` translator even with no app
 * formatters, for the document gate: its denials are ordinary replies that
 * still have to reach the wire.
 */
const emitErrorHelpers = (
  errorsExport: string | undefined,
  onErrorExport: string | undefined,
  used: Record<string, boolean>,
  needsToResponse: boolean,
): string[] => {
  const lines: string[] = []
  if (errorsExport !== undefined || onErrorExport !== undefined || needsToResponse) {
    lines.push(
      // Mirrors the fetch adapter's ApiResponse → Response translation so a
      // formatter's reply (headers, raw contentType and all) serializes the
      // same way in both engines — including the boundary that turns a
      // throwing translation (circular body, invalid header name) into the
      // pipeline's own 500.
      'const toResponse = (r) => {',
      '  try {',
      // The same escape hatch a handler reply gets: an `onError` or an
      // `errors.*` formatter may answer with `raw(response)` (a redirect, a
      // proxied upstream body, a hand-built error page) and that Response goes
      // out verbatim. Without this the reply fell through to the empty-body
      // branch and the payload vanished.
      '    if (r.raw !== undefined) return r.raw',
      '    if (r.contentType !== undefined) {',
      "      return new Response(r.body ?? null, { status: r.status, headers: r.headers === undefined ? { 'content-type': r.contentType } : buildResponseHeaders(r.headers, r.contentType) })",
      '    }',
      '    if (r.headers === undefined) {',
      '      return r.body === undefined ? new Response(null, { status: r.status }) : new Response(JSON.stringify(r.body), initFor(r.status))',
      '    }',
      '    return r.body === undefined',
      '      ? new Response(null, { status: r.status, headers: buildResponseHeaders(r.headers) })',
      "      : new Response(JSON.stringify(r.body), { status: r.status, headers: buildResponseHeaders(r.headers, 'application/json') })",
      '  } catch {',
      '    return internalError()',
      '  }',
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
    if (used['invalidBody']) {
      lines.push('const invalidBody = () => new Response(\'{"error":"invalid_body"}\', initFor(400))')
    }
    if (used['unsupportedMediaType']) {
      lines.push(
        'const unsupportedMediaType = () => new Response(\'{"error":"unsupported_media_type"}\', initFor(415))',
      )
    }
  } else {
    lines.push(
      `const notFound = (request, url, rawPath, queryIndex, locals) => ${errorsExport}.notFound !== undefined ? toResponse(${errorsExport}.notFound(makeApiRequest(request, url, rawPath, queryIndex, locals))) : new Response('{"error":"not_found"}', initFor(404))`,
      `const invalidJson = (request, url, rawPath, queryIndex, locals) => ${errorsExport}.invalidJson !== undefined ? toResponse(${errorsExport}.invalidJson(makeApiRequest(request, url, rawPath, queryIndex, locals))) : new Response('{"error":"invalid_json"}', initFor(400))`,
      `const payloadTooLarge = (request, url, rawPath, queryIndex, locals) => ${errorsExport}.payloadTooLarge !== undefined ? toResponse(${errorsExport}.payloadTooLarge(makeApiRequest(request, url, rawPath, queryIndex, locals))) : new Response('{"error":"payload_too_large"}', initFor(413))`,
      `const methodNotAllowed = (allow, request, url, rawPath, queryIndex, locals) => ${errorsExport}.methodNotAllowed !== undefined ? toResponse(${errorsExport}.methodNotAllowed(allow, makeApiRequest(request, url, rawPath, queryIndex, locals))) : ${defaultMethodNotAllowed}`,
    )
    if (used['invalidBody']) {
      lines.push(
        `const invalidBody = (request, url, rawPath, queryIndex, locals) => ${errorsExport}.invalidBody !== undefined ? toResponse(${errorsExport}.invalidBody(makeApiRequest(request, url, rawPath, queryIndex, locals))) : new Response('{"error":"invalid_body"}', initFor(400))`,
      )
    }
    if (used['unsupportedMediaType']) {
      lines.push(
        `const unsupportedMediaType = (contentType, request, url, rawPath, queryIndex, locals) => ${errorsExport}.unsupportedMediaType !== undefined ? toResponse(${errorsExport}.unsupportedMediaType(contentType, makeApiRequest(request, url, rawPath, queryIndex, locals))) : new Response('{"error":"unsupported_media_type"}', initFor(415))`,
      )
    }
  }
  // The 413 check runs first in both variants: an oversized body is the
  // transport's outcome, not an application error to report.
  if (onErrorExport === undefined) {
    lines.push(
      'const thrown = (error, route, request, url, rawPath, queryIndex, locals) => isPayloadTooLargeError(error) ? payloadTooLarge(request, url, rawPath, queryIndex, locals) : internalError()',
    )
  } else {
    lines.push(
      'const thrown = (error, route, request, url, rawPath, queryIndex, locals, env, executionContext) => isPayloadTooLargeError(error)',
      '  ? payloadTooLarge(request, url, rawPath, queryIndex, locals)',
      `  : toResponse(${onErrorExport}(error, makeApiRequest(request, url, rawPath, queryIndex, locals), { route, env, executionContext }))`,
    )
  }
  if (used['failValidation']) {
    if (errorsExport === undefined) {
      lines.push(
        'const failValidation = (source, collect, value) => {',
        '  const result = collect()(value)',
        "  return new Response(JSON.stringify({ error: 'validation_failed', source, errors: result === true ? [] : result.errors }), initFor(400))",
        '}',
      )
    } else {
      lines.push(
        'const failValidation = (source, collect, value, request, url, rawPath, queryIndex, locals) => {',
        '  const result = collect()(value)',
        '  const errors = result === true ? [] : result.errors',
        `  if (${errorsExport}.validationFailed !== undefined) {`,
        `    return toResponse(${errorsExport}.validationFailed({ source, errors }, makeApiRequest(request, url, rawPath, queryIndex, locals)))`,
        '  }',
        "  return new Response(JSON.stringify({ error: 'validation_failed', source, errors }), initFor(400))",
        '}',
      )
    }
  }
  // Refinement failures normalize through the shared helper so the envelope
  // is byte-identical to the runtime engine's, custom formatter included.
  if (used['refine']) {
    if (errorsExport === undefined) {
      lines.push(
        'const failRefine = (issues) => {',
        '  const failure = refinementFailure(issues)',
        "  return new Response(JSON.stringify({ error: 'validation_failed', source: failure.source, errors: failure.errors }), initFor(400))",
        '}',
      )
    } else {
      lines.push(
        'const failRefine = (issues, request, url, rawPath, queryIndex, locals) => {',
        '  const failure = refinementFailure(issues)',
        `  if (${errorsExport}.validationFailed !== undefined) {`,
        `    return toResponse(${errorsExport}.validationFailed(failure, makeApiRequest(request, url, rawPath, queryIndex, locals)))`,
        '  }',
        "  return new Response(JSON.stringify({ error: 'validation_failed', source: failure.source, errors: failure.errors }), initFor(400))",
        '}',
      )
    }
  }
  return lines
}

/**
 * Emits the guarded OpenAPI document endpoint. The document is answered before
 * routing, so `secureRoutes` never sees it — under a deny-by-default API these
 * guards are the only thing keeping the schema off the open internet. They run
 * exactly like a route's security guards: the context factory first (they gate
 * on the session it resolves), then the guards in order with the request slots
 * `undefined`, first denial winning. No contract sits behind this endpoint, so
 * a denial is sent as-is — there is no response schema to check it against.
 */
const emitOpenApiGate = (guardExports: readonly string[], contextExport: string | undefined): string[] => {
  // `route: undefined` is what the runtime engine reports for the document
  // endpoint, since no contract produced the error.
  const thrown = 'thrown(error, undefined, request, url, rawPath, queryIndex, locals, env, executionContext)'
  const lines = [
    `const OPENAPI_GUARDS = [${guardExports.join(', ')}]`,
    'const guardedOpenApi = (method, request, url, rawPath, queryIndex, locals, env, executionContext) => {',
    '  const apiRequest = makeApiRequest(request, url, rawPath, queryIndex, locals)',
    // Serving the document is the same answer the unguarded dispatch inlines;
    // it lives in a closure here so the gate can reach it once every guard has
    // passed.
    '  const serve = () => {',
    "    const ifNoneMatch = request.headers.get('if-none-match')",
    '    if (ifNoneMatch !== null && openApiEtagMatches(ifNoneMatch)) return new Response(null, { status: 304, headers: OPENAPI_304_HEADERS })',
    "    return method === 'HEAD' ? new Response(null, { status: 200, headers: OPENAPI_HEADERS }) : new Response(OPENAPI_JSON, { status: 200, headers: OPENAPI_HEADERS })",
    '  }',
    // A denial is an ordinary reply (or the raw-Response escape hatch), and a
    // HEAD request gets it without a body like every other HEAD reply.
    "  const deny = (reply) => { const response = reply.raw !== undefined ? reply.raw : toResponse(reply); return method === 'HEAD' ? stripHeadBody(response) : response }",
    '  const guardRequest = (appContext) => {',
    '    const gate = { params: undefined, query: undefined, body: undefined, headers: undefined, cookies: undefined, context: appContext, request: apiRequest }',
    '    try {',
    '      const denied = runGuards(OPENAPI_GUARDS, gate, 0)',
    "      if (denied != null && typeof denied.then === 'function') {",
    `        return denied.then((early) => (early !== undefined ? deny(early) : serve()), (error) => ${thrown})`,
    '      }',
    '      return denied !== undefined ? deny(denied) : serve()',
    '    } catch (error) {',
    `      return ${thrown}`,
    '    }',
    '  }',
  ]
  if (contextExport === undefined) {
    lines.push('  return guardRequest(undefined)')
  } else {
    lines.push(
      '  let appContext',
      '  try {',
      `    appContext = ${contextExport}({ request: apiRequest, env, executionContext, locals })`,
      '  } catch (error) {',
      `    return ${thrown}`,
      '  }',
      `  return typeof appContext?.then === 'function' ? appContext.then(guardRequest, (error) => ${thrown}) : guardRequest(appContext)`,
    )
  }
  lines.push('}')
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

/**
 * The methods this emitter knows how to dispatch. `defineRoute` and
 * `defineContract` are identity functions with no runtime validation, so a
 * contract assembled programmatically — from a config file, a database row, a
 * plugin, an imported OpenAPI document — reaches the emitter exactly as
 * written. Every one of these values lands inside emitted source, so the
 * emitter treats a contract as untrusted input and refuses anything it cannot
 * interpolate safely.
 */
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

/** The body encodings `matchesBodyType` understands — same interpolation risk. */
const BODY_TYPES = new Set(['json', 'form', 'multipart', 'text', 'bytes'])

/**
 * Narrows a response key to an HTTP status code. Every status becomes both an
 * identifier fragment (`serialize_<route>_<status>`) and a bare numeric literal
 * in expression position, so a key like `200); doSomething(` would otherwise
 * close the declaration it was meant to name and run whatever followed. Call
 * sites emit the returned number, never the original key.
 */
const assertStatus = (status: string, path: string): number => {
  const code = Number(status)
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    throw new Error(`Response status '${status}' on '${path}' must be an integer between 100 and 599`)
  }
  return code
}

const compileEntry = (name: string, contract: AnyRouteContract): CompiledEntry => {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Route key '${name}' must be a valid identifier (it becomes an import name)`)
  }
  if (typeof contract.method !== 'string' || !HTTP_METHODS.has(contract.method.toLowerCase())) {
    throw new Error(`Route '${name}' has an unsupported method '${String(contract.method)}'`)
  }
  const bodyType = contract.request?.bodyType
  if (bodyType !== undefined && !BODY_TYPES.has(bodyType)) {
    throw new Error(`Route '${name}' has an unsupported bodyType '${String(bodyType)}'`)
  }
  // Validated here rather than at each emit site so a hostile key fails the
  // build once, before any of it reaches the output.
  for (const status of Object.keys(contract.responses)) assertStatus(status, contract.path)
  const segments = parsePathPattern(contract.path)
  const isStatic = segments.every((segment) => typeof segment === 'string')
  return {
    name,
    contract,
    method: contract.method.toUpperCase(),
    segments,
    isStatic,
    staticPath:
      '/' +
      segments
        .map((segment) => (typeof segment === 'string' ? segment : segment.greedy === true ? '{}+' : '{}'))
        .join('/'),
    paramNames: segments.flatMap((segment) => (typeof segment === 'string' ? [] : [segment.name])),
  }
}

/**
 * The match test and captures for one dynamic route over a split-segments
 * variable — shared by the per-method dispatch, the HEAD fallback, and the
 * 405 allow scan so all three agree on greedy-tail semantics: a `{name+}`
 * tail matches one or more remaining segments, decoded individually and
 * rejoined (same as the runtime matcher).
 */
const dynamicMatch = (
  route: CompiledEntry,
  segmentsVar: string,
): { readonly conditions: string[]; readonly captures: string[] } => {
  const tail = route.segments[route.segments.length - 1]
  const greedy = typeof tail === 'object' && tail.greedy === true
  const conditions = [
    greedy ? `${segmentsVar}.length >= ${route.segments.length}` : `${segmentsVar}.length === ${route.segments.length}`,
  ]
  const captures: string[] = []
  route.segments.forEach((segment, index) => {
    if (typeof segment === 'string') {
      conditions.push(`${segmentsVar}[${index}] === ${JSON.stringify(segment)}`)
    } else if (segment.greedy === true) {
      captures.push(`${segmentsVar}.slice(${index}).map(decodeSegment).join('/')`)
    } else {
      captures.push(`decodeSegment(${segmentsVar}[${index}])`)
    }
  })
  return { conditions, captures }
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
    lines.push(`const schema${suffix} = ${jsonConstant(schema)}`)
    if (emitContext.compileExport !== undefined) {
      // With a custom compiler nothing is inlined — the exported compiler
      // builds guard and collector at init, mirroring how the runtime engine
      // routes every schema through `options.compile`.
      lines.push(
        `const compiled${suffix} = ${emitContext.compileExport}(schema${suffix})`,
        `const guard${suffix} = compiled${suffix}.guard`,
        `const collect${suffix} = () => compiled${suffix}.collect`,
      )
    } else {
      const generated = generateGuardSource(schema, 'g' + suffix, emitContext.validateOptions !== undefined)
      const opts = emitContext.validateOptions === undefined ? '' : `, ${VALIDATE_OPTIONS_VAR}`
      if (generated === undefined) {
        used['validateGuard'] = true
        lines.push(`const guard${suffix} = validateGuard(schema${suffix}${opts})`)
      } else {
        used['codePoints'] = used['codePoints'] || generated.usesCodePoints
        used['compileRx'] = used['compileRx'] || generated.usesCompileRx
        lines.push(...generated.declarations)
        lines.push(`const guard${suffix} = ${generated.expression}`)
      }
      used['validate'] = true
      lines.push(
        `let _collect${suffix}`,
        `const collect${suffix} = () => (_collect${suffix} ??= validate(schema${suffix}${opts}))`,
      )
    }
    used['failValidation'] = true
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
    // Form and multipart fields arrive as strings, so the body slot carries a
    // coercion plan exactly like query parameters; JSON values are already
    // typed and need none.
    if (slot === 'body' && (request?.bodyType ?? 'json') !== 'json') {
      const plan = [...buildCoercionPlan(schema)]
      lines.push(`const coercions${suffix} = new Map(${JSON.stringify(plan.map(([key, kind]) => [key, kind]))})`)
    }
  }

  const serialized: number[] = []
  const rawStatuses: Array<readonly [status: number, contentType: string]> = []
  for (const [status, response] of Object.entries(route.contract.responses)) {
    // Never the raw key: it is attacker-shaped text becoming an identifier
    // and a numeric literal. `compileEntry` already rejected anything that is
    // not a status code, and this is where the narrowed number is used.
    const code = assertStatus(status, route.contract.path)
    if (response.contentType !== undefined) {
      // Raw statuses skip serialization entirely — the body goes straight to
      // the Response constructor, streaming intact.
      rawStatuses.push([code, response.contentType])
      continue
    }
    if (response.body === undefined) continue
    // With response validation on, bodies serialize via JSON.stringify like
    // the runtime engine — a schema-derived serializer could only disagree
    // with a validator over the exact schemas validation just checked.
    if (emitContext.validateResponses) continue
    const source = generateSerializerSource(response.body)
    if (source !== undefined) {
      serialized.push(code)
      lines.push(`const serialize_${route.name}_${code} = ${source}`)
    }
  }

  const replyChecks: string[] = []
  if (emitContext.validateResponses) {
    // The reply validators mirror compileRoute: body validators only for
    // JSON statuses (raw contentType bodies have no JSON value to check),
    // header validators as an open object over the declared header schemas,
    // and the declared-status set for the undeclared-reply 500.
    const statuses = Object.keys(route.contract.responses).map((status) => assertStatus(status, route.contract.path))
    lines.push(`const declared_${route.name} = new Set(${JSON.stringify(statuses)})`)
    replyChecks.push(
      `    if (!declared_${route.name}.has(reply.status)) return invalidResponse(reply.status, undefined, true)`,
    )
    for (const [status, response] of Object.entries(route.contract.responses)) {
      const code = assertStatus(status, route.contract.path)
      const bodySchema = response.contentType === undefined ? response.body : undefined
      const headerSchemas = response.headers
      if (bodySchema === undefined && headerSchemas === undefined) continue
      const checks: string[] = []
      if (bodySchema !== undefined) {
        const name = `replyBody_${route.name}_${code}`
        lines.push(
          `const ${name}Schema = ${jsonConstant(bodySchema)}`,
          `const ${name} = ${compiledValidationExpression(`${name}Schema`, emitContext, used)}`,
        )
        checks.push(
          `      if (!${name}.guard(reply.body)) return invalidResponse(${code}, undefined, ${name}.collect(reply.body))`,
        )
      }
      if (headerSchemas !== undefined) {
        const name = `replyHeaders_${route.name}_${code}`
        lines.push(
          `const ${name}Schema = ${jsonConstant({ type: 'object', properties: headerSchemas })}`,
          `const ${name} = ${compiledValidationExpression(`${name}Schema`, emitContext, used)}`,
        )
        checks.push(
          '      const replyHeaders = reply.headers ?? {}',
          `      if (!${name}.guard(replyHeaders)) return invalidResponse(${code}, 'headers', ${name}.collect(replyHeaders))`,
        )
      }
      replyChecks.push(`    if (reply.status === ${code}) {`, ...checks, '    }')
    }
  }

  const bodyExpression = serialized
    .map((status) => `reply.status === ${status} ? serialize_${route.name}_${status}(reply.body) : `)
    .join('')
  // The try/catch mirrors the fetch adapter's translation boundary: a reply
  // that cannot serialize (circular body, invalid header name) becomes the
  // pipeline's 500 instead of an escaped rejection.
  lines.push(`const respond_${route.name} = (reply) => {`, '  try {')
  // The escape hatch: a handler that returns `raw(response)` sends it verbatim,
  // bypassing reply validation and serialization — HEAD strips its body
  // downstream via stripHeadBody, like any other Response.
  lines.push('    if (reply.raw !== undefined) return reply.raw')
  // Reply validation runs first — before the raw-status returns and the
  // serializers — matching the runtime pipeline, where runRoute validates
  // the reply before the adapter ever sees it.
  lines.push(...replyChecks)
  for (const [status, contentType] of rawStatuses) {
    lines.push(
      `    if (reply.status === ${status}) return new Response(reply.body ?? null, { status: ${status}, headers: reply.headers === undefined ? { 'content-type': ${JSON.stringify(contentType)} } : buildResponseHeaders(reply.headers, ${JSON.stringify(contentType)}) })`,
    )
  }
  lines.push(
    `    const body = ${bodyExpression}reply.body === undefined ? null : JSON.stringify(reply.body)`,
    '    if (reply.headers === undefined) {',
    '      return body === null ? new Response(null, { status: reply.status }) : new Response(body, initFor(reply.status))',
    '    }',
    '    return body === null',
    '      ? new Response(null, { status: reply.status, headers: buildResponseHeaders(reply.headers) })',
    "      : new Response(body, { status: reply.status, headers: buildResponseHeaders(reply.headers, 'application/json') })",
    '  } catch {',
    '    return internalError()',
    '  }',
    '}',
  )

  lines.push(...emitRouteFunction(route, used, emitContext), '')
  return lines
}

const slotSuffix = (slot: 'params' | 'query' | 'headers' | 'cookies' | 'body', name: string): string =>
  slot.charAt(0).toUpperCase() + slot.slice(1) + '_' + name

/**
 * Bakes contract data into the emitted module as `JSON.parse('…')` rather than
 * as a bare object literal.
 *
 * An object literal is *not* a faithful copy of the JSON it was printed from:
 * `{"__proto__": {...}}` written as source runs the prototype setter, so that
 * key never becomes a property. For a validation schema that is a bypass, not
 * a cosmetic difference — a contract declaring a property named `__proto__`
 * (perfectly ordinary in a schema loaded from a config file or an imported
 * OpenAPI document, where the key really does exist) compiled to a constant
 * with the constraint silently missing. The compiled engine then accepted
 * input the runtime engine rejected, and rejected input it accepted, which is
 * exactly the divergence the differential corpus exists to prevent.
 *
 * `JSON.parse` has no such rule: every key lands as an own property, matching
 * the schema objects the runtime engine holds (which came from a module or a
 * parsed document, never from re-evaluated source). It is also not a cost —
 * engines parse a JSON string literal faster than they build the equivalent
 * object literal.
 *
 * The argument is emitted as a single-quoted JS string literal. `JSON.stringify`
 * output never contains a raw control character or line terminator (it escapes
 * everything below U+0020, and lone surrogates besides), so escaping the two
 * characters that could end the literal — `\` and `'` — is sufficient. U+2028
 * and U+2029 are escaped as well: they are legal unescaped inside a JSON
 * string but were line terminators in JavaScript source before ES2019, and
 * generated code should not depend on the parser being new enough.
 */
const jsonConstant = (value: unknown): string => {
  const json = JSON.stringify(value)
  const escaped = json
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `JSON.parse('${escaped}')`
}

/** The request-context arguments every cold-path helper receives. */
const ERROR_ARGS = 'request, url, rawPath, queryIndex, locals'

/**
 * What the emitters need to know about the module-wide wiring: the context
 * factory's export name, and whether route functions must accept the platform
 * `env`/`executionContext` arguments (required by the context factory and by
 * the onError contract alike).
 */
type EmitContext = {
  readonly contextExport: string | undefined
  readonly needsPlatform: boolean
  /** ValidatorCompiler export name; guards come from it instead of inlining when set. */
  readonly compileExport: string | undefined
  /**
   * Serialized `ValidateOptions` for the interpreter, or `undefined` when the
   * defaults apply. Set means every `validate`/`validateGuard` call in the
   * output takes {@link VALIDATE_OPTIONS_VAR} as its second argument, and
   * format-bearing schemas stop being inlined.
   */
  readonly validateOptions: string | undefined
  /** Whether replies are validated against the response contracts (see the option). */
  readonly validateResponses: boolean
}

/**
 * The init-time expression producing a `{ guard, collect }` pair for one
 * schema constant: the exported custom compiler when configured, the
 * interpreter (built eagerly, exactly like `createApi`'s `defaultCompile`)
 * otherwise. Mutates `used` so the interpreter imports only appear when
 * something references them.
 */
const compiledValidationExpression = (
  schemaVar: string,
  emitContext: EmitContext,
  used: Record<string, boolean>,
): string => {
  if (emitContext.compileExport !== undefined) return `${emitContext.compileExport}(${schemaVar})`
  used['validate'] = true
  used['validateGuard'] = true
  const opts = emitContext.validateOptions === undefined ? '' : `, ${VALIDATE_OPTIONS_VAR}`
  return `{ guard: validateGuard(${schemaVar}${opts}), collect: validate(${schemaVar}${opts}) }`
}

/**
 * Emits the route function itself: coerce + guard the declared slots in the
 * same order as the runtime pipeline (params, query, headers, then body),
 * build the context, call the untouched user handler, and map the reply.
 *
 * A route whose OpenAPI `security` resolved into guards gets that pipeline as
 * `run_<name>`, wrapped by the gate {@link emitSecurityGate} emits — nothing
 * below runs until the guards have passed.
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
    'locals',
    ...(needsPlatform ? ['env', 'executionContext'] : []),
    ...route.paramNames.map((_, i) => 'p' + i),
  ]
  const securityGuards = route.contract.securityGuards
  const secured = securityGuards !== undefined && securityGuards.length > 0
  if (secured) used['guards'] = true
  // Gated routes take the request and the app context the gate already built:
  // the factory must run exactly once per request, and the gate needed it
  // before this pipeline exists.
  lines.push(
    secured
      ? `const run_${route.name} = (apiRequest, appContext, ${parameters.join(', ')}) => {`
      : `const route_${route.name} = (${parameters.join(', ')}) => {`,
  )

  let paramsValue = 'undefined'
  if (request?.params !== undefined) {
    const plan = buildCoercionPlan(request.params)
    const captureValue = (name: string, index: number): string => {
      const kind = plan.get(name)
      if (kind === 'number' || kind === 'boolean') {
        used['coercePrimitive'] = true
        return `coercePrimitive(p${index}, '${kind}')`
      }
      return `p${index}`
    }
    // A capture named `{__proto__}` cannot ride in the object literal: the
    // literal form runs the prototype setter, so the parameter would be gone
    // before the guard sees it (and `required` could never be satisfied). The
    // names are known here, so the split costs nothing at runtime — the
    // ordinary case still emits exactly the literal it always did.
    const entries = route.paramNames.map((name, index) => [name, captureValue(name, index)] as const)
    const fields = entries.filter(([name]) => name !== '__proto__')
    const protoFields = entries.filter(([name]) => name === '__proto__')
    const suffix = slotSuffix('params', route.name)
    const literal = fields.map(([name, value]) => `${JSON.stringify(name)}: ${value}`).join(', ')
    lines.push(`  const params = ${literal === '' ? '{}' : `{ ${literal} }`}`)
    for (const [name, value] of protoFields) {
      lines.push(
        `  Object.defineProperty(params, ${JSON.stringify(name)}, { value: ${value}, writable: true, enumerable: true, configurable: true })`,
      )
    }
    lines.push(
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
      // `__proto__` is a legal HTTP field name, and a plain assignment under
      // that one name runs the prototype setter instead of creating the
      // property — the same drop `buildHeadersObject` guards against on the
      // runtime side. The name is known at emit time, so only that case pays.
      const write =
        name === '__proto__'
          ? `Object.defineProperty(headers, ${JSON.stringify(name)}, { value: ${valueExpression}, writable: true, enumerable: true, configurable: true })`
          : `headers[${JSON.stringify(name)}] = ${valueExpression}`
      lines.push(
        `  const h${index} = request.headers.get(${JSON.stringify(name.toLowerCase())})`,
        `  if (h${index} !== null) ${write}`,
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

  const guards = route.contract.guards
  const hasGuards = guards !== undefined && guards.length > 0
  if (hasGuards) used['guards'] = true
  const invokeLines = (bodyValue: string, appContextValue: string, indent: string): string[] => {
    const context = `${indent}const context = { params: ${paramsValue}, query: ${queryValue}, body: ${bodyValue}, headers: ${headersValue}, cookies: ${cookiesValue}, context: ${appContextValue}, request: apiRequest }`
    if (!hasGuards) {
      return [
        context,
        `${indent}try {`,
        `${indent}  const reply = ${route.name}.handler(context)`,
        `${indent}  return typeof reply?.then === 'function' ? reply.then(respond_${route.name}, (error) => thrown(error, ${thrownArguments})) : respond_${route.name}(reply)`,
        `${indent}} catch (error) {`,
        `${indent}  return thrown(error, ${thrownArguments})`,
        `${indent}}`,
      ]
    }
    // Guarded: run the guards first (mirroring the runtime pipeline's loop),
    // and only reach the handler if none denied. A guard's reply short-circuits
    // through respond_* — the same response-validation and serialization path a
    // handler reply takes — and a thrown/rejected guard or handler routes to
    // thrown. runHandler catches its own sync throw so it is safe to call from
    // inside the async continuation too, matching the runtime's single try.
    return [
      context,
      `${indent}const runHandler = () => {`,
      `${indent}  try {`,
      `${indent}    const reply = ${route.name}.handler(context)`,
      `${indent}    return typeof reply?.then === 'function' ? reply.then(respond_${route.name}, (error) => thrown(error, ${thrownArguments})) : respond_${route.name}(reply)`,
      `${indent}  } catch (error) {`,
      `${indent}    return thrown(error, ${thrownArguments})`,
      `${indent}  }`,
      `${indent}}`,
      `${indent}try {`,
      `${indent}  const guarded = runGuards(${route.name}.guards, context, 0)`,
      `${indent}  if (guarded != null && typeof guarded.then === 'function') {`,
      `${indent}    return guarded.then((early) => (early !== undefined ? respond_${route.name}(early) : runHandler()), (error) => thrown(error, ${thrownArguments}))`,
      `${indent}  }`,
      `${indent}  return guarded !== undefined ? respond_${route.name}(guarded) : runHandler()`,
      `${indent}} catch (error) {`,
      `${indent}  return thrown(error, ${thrownArguments})`,
      `${indent}}`,
    ]
  }

  const runLines = (bodyValue: string, indent: string): string[] => {
    const lines: string[] = []
    if (contextExport === undefined) {
      lines.push(...invokeLines(bodyValue, 'undefined', indent))
      return lines
    }
    // A gated route's context arrived as an argument: its security guards gate
    // on the session, so the factory already ran before validation and its one
    // value is reused here — the factory runs once per request either way.
    if (secured) {
      lines.push(...invokeLines(bodyValue, 'appContext', indent))
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
      `${indent}  appContext = ${contextExport}({ request: apiRequest, env, executionContext, locals })`,
      `${indent}} catch (error) {`,
      `${indent}  return thrown(error, ${thrownArguments})`,
      `${indent}}`,
      `${indent}return typeof appContext?.then === 'function' ? appContext.then(proceed, (error) => thrown(error, ${thrownArguments})) : proceed(appContext)`,
    )
    return lines
  }

  // Refinement mirrors the runtime pipeline: after every declared slot has
  // validated, before the context factory and handler, with a throwing or
  // rejecting refine taking the handler-error path. Sync and async refines
  // share one continuation so both verdicts run identical code.
  const refineAndRunLines = (bodyValue: string, indent: string): string[] => {
    if (route.contract.refine === undefined) return runLines(bodyValue, indent)
    used['refine'] = true
    return [
      `${indent}const afterRefine = (refineIssues) => {`,
      `${indent}  if (refineIssues !== undefined && refineIssues.length > 0) return failRefine(refineIssues, ${ERROR_ARGS})`,
      ...runLines(bodyValue, indent + '  '),
      `${indent}}`,
      `${indent}let refineResult`,
      `${indent}try {`,
      `${indent}  refineResult = ${route.name}.refine({ params: ${paramsValue}, query: ${queryValue}, body: ${bodyValue}, headers: ${headersValue}, cookies: ${cookiesValue} })`,
      `${indent}} catch (error) {`,
      `${indent}  return thrown(error, ${thrownArguments})`,
      `${indent}}`,
      `${indent}return typeof refineResult?.then === 'function' ? refineResult.then(afterRefine, (error) => thrown(error, ${thrownArguments})) : afterRefine(refineResult)`,
    ]
  }

  // The apiRequest is built after the zero-cost guards (params, query,
  // headers) so guard-rejected requests allocate nothing, and before the body
  // read so exactly one object owns the single-use body stream. A gated route
  // already has it: its security guards see the raw request, so the gate built
  // it up front and passed it down.
  if (!secured) lines.push(`  const apiRequest = makeApiRequest(${ERROR_ARGS})`)
  if (request?.body !== undefined) {
    const bodyType = request.bodyType ?? 'json'
    const suffix = slotSuffix('body', route.name)
    used['matchesBodyType'] = true
    used['unsupportedMediaType'] = true
    // A present-but-contradictory content-type is a 415 before any read; an
    // absent one falls through to the parse — same rule as the runtime.
    lines.push(
      "  const bodyContentType = request.headers.get('content-type')",
      `  if (bodyContentType !== null && !matchesBodyType(bodyContentType, ${JSON.stringify(bodyType)})) return unsupportedMediaType(bodyContentType, ${ERROR_ARGS})`,
    )
    const guardAndRun = [
      `    if (!guard${suffix}(body)) return failValidation('body', collect${suffix}, body, ${ERROR_ARGS})`,
      ...refineAndRunLines('body', '    '),
    ]
    if (bodyType === 'json') {
      lines.push(
        '  return apiRequest.readBody().then((body) => {',
        ...guardAndRun,
        `  }, (error) => isPayloadTooLargeError(error) ? payloadTooLarge(${ERROR_ARGS}) : invalidJson(${ERROR_ARGS}))`,
      )
    } else if (bodyType === 'text' || bodyType === 'bytes') {
      used['invalidBody'] = true
      // Raw encodings: the decoded string (readText) or the bytes (readBytes)
      // are validated against the schema as-is, no parse step to fail — so the
      // rejection handler only distinguishes an over-cap read from a read error.
      const reader = bodyType === 'text' ? 'readText' : 'readBytes'
      lines.push(
        `  return apiRequest.${reader}().then((body) => {`,
        ...guardAndRun,
        `  }, (error) => isPayloadTooLargeError(error) ? payloadTooLarge(${ERROR_ARGS}) : invalidBody(${ERROR_ARGS}))`,
      )
    } else if (bodyType === 'form') {
      used['parseFormBody'] = true
      used['invalidBody'] = true
      lines.push(
        '  return apiRequest.readText().then((text) => {',
        '    let body',
        `    try { body = parseFormBody(text, coercions${suffix}) } catch { return invalidBody(${ERROR_ARGS}) }`,
        ...guardAndRun,
        `  }, (error) => isPayloadTooLargeError(error) ? payloadTooLarge(${ERROR_ARGS}) : invalidBody(${ERROR_ARGS}))`,
      )
    } else {
      used['parseMultipartBody'] = true
      used['invalidBody'] = true
      // The second .then's rejection handler covers both the read and the
      // multipart parse, matching the runtime's single try block.
      lines.push(
        `  return apiRequest.readBytes().then((bytes) => parseMultipartBody(bytes, bodyContentType ?? undefined, coercions${suffix})).then((body) => {`,
        ...guardAndRun,
        `  }, (error) => isPayloadTooLargeError(error) ? payloadTooLarge(${ERROR_ARGS}) : invalidBody(${ERROR_ARGS}))`,
      )
    }
  } else {
    lines.push(...refineAndRunLines('undefined', '  '))
  }
  lines.push('}')
  if (secured) lines.push(...emitSecurityGate(route, emitContext, thrownArguments, parameters))
  return lines
}

/**
 * Emits the security gate wrapping a route whose OpenAPI `security` resolved
 * into guards: build the request, build the app context (the guards gate on the
 * session it resolves), run the guards in order, and only then hand off to the
 * validation pipeline with that same context. An unauthenticated caller
 * therefore never reaches the body reader, the schema error detail, or `refine`
 * — the deny-by-default promise the runtime engine makes, in emitted form.
 *
 * A denial rides `respond_*`, the same response path a handler reply takes, and
 * a throwing guard or factory takes the ordinary error path.
 */
const emitSecurityGate = (
  route: CompiledEntry,
  emitContext: EmitContext,
  thrownArguments: string,
  parameters: readonly string[],
): string[] => {
  const { contextExport } = emitContext
  const proceed = `run_${route.name}(apiRequest, appContext, ${parameters.join(', ')})`
  const lines = [
    `const route_${route.name} = (${parameters.join(', ')}) => {`,
    `  const apiRequest = makeApiRequest(${ERROR_ARGS})`,
    '  const guardRequest = (appContext) => {',
    // No slot has been validated yet, which is exactly what a security guard is
    // documented to see: the session on the context, and the raw request.
    '    const gate = { params: undefined, query: undefined, body: undefined, headers: undefined, cookies: undefined, context: appContext, request: apiRequest }',
    '    try {',
    // The live contract's array, not a build-time copy — the guards resolved by
    // `secureRoutes` are threaded exactly like the route's own `guards`.
    `      const denied = runGuards(${route.name}.securityGuards, gate, 0)`,
    "      if (denied != null && typeof denied.then === 'function') {",
    `        return denied.then((early) => (early !== undefined ? respond_${route.name}(early) : ${proceed}), (error) => thrown(error, ${thrownArguments}))`,
    '      }',
    `      return denied !== undefined ? respond_${route.name}(denied) : ${proceed}`,
    '    } catch (error) {',
    `      return thrown(error, ${thrownArguments})`,
    '    }',
    '  }',
  ]
  if (contextExport === undefined) {
    lines.push('  return guardRequest(undefined)')
  } else {
    // The factory runs before validation here — the usual "build it late" saving
    // does not apply to a route whose whole point is rejecting early — and its
    // value is handed to the pipeline below, so it still runs once per request.
    lines.push(
      '  let appContext',
      '  try {',
      `    appContext = ${contextExport}({ request: apiRequest, env, executionContext, locals })`,
      '  } catch (error) {',
      `    return thrown(error, ${thrownArguments})`,
      '  }',
      `  return typeof appContext?.then === 'function' ? appContext.then(guardRequest, (error) => thrown(error, ${thrownArguments})) : guardRequest(appContext)`,
    )
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
  observeExport: string | undefined,
  observeUnmatchedExport: string | undefined,
  onErrorExport: string | undefined,
  openApiGuarded: boolean,
): string[] => {
  const hooked = onRequestExports.length > 0 || onResponseExports.length > 0
  const extraArguments = emitContext.needsPlatform ? ', env, executionContext' : ''
  // Hooked builds already wrap this in an `async` fetch (which turns a
  // synchronous throw into a rejection on its own); unhooked ones export a
  // thin wrapper below that does the same by hand, so the dispatch itself is
  // private in both shapes.
  //
  // The names are prefixed because the emitted module imports the app's own
  // exports unaliased: an app exporting `dispatchFetch` and wiring it as a
  // mount or hook would otherwise produce a module declaring that name twice,
  // failing to load with a `SyntaxError` that points at nothing.
  const dispatchName = hooked ? 'mjstHandleFetch' : 'mjstDispatchFetch'
  // With an observer, every route invocation flows through `observed`, which
  // times the route function (validation + handler + serialization — the
  // same span the runtime engine measures) and reports the outcome status.
  // Without one, calls stay direct and the hot path pays nothing.
  const invoke =
    observeExport === undefined
      ? (_route: CompiledEntry, call: string): string => call
      : (route: CompiledEntry, call: string): string =>
          `observed(${route.name}, () => ${call}, request, url, rawPath, queryIndex, locals${extraArguments})`
  const lines: string[] = []
  if (observeExport !== undefined) {
    lines.push(
      'const observed = (contract, run, request, url, rawPath, queryIndex, locals, env, executionContext) => {',
      '  const start = performance.now()',
      '  const finish = (response) => {',
      '    try {',
      `      ${observeExport}({ route: contract, request: makeApiRequest(request, url, rawPath, queryIndex, locals), status: response.status, durationMs: performance.now() - start, env, executionContext })`,
      '    } catch {',
      '      // A throwing observer must never fail the request it watched.',
      '    }',
      '    return response',
      '  }',
      '  const reply = run()',
      "  return typeof reply?.then === 'function' ? reply.then(finish) : finish(reply)",
      '}',
    )
  }
  if (observeUnmatchedExport !== undefined) {
    lines.push(
      'const observedMiss = (response, request, url, rawPath, queryIndex, locals, env, executionContext, start) => {',
      '  try {',
      `    ${observeUnmatchedExport}({ route: undefined, request: makeApiRequest(request, url, rawPath, queryIndex, locals), status: response.status, durationMs: performance.now() - start, env, executionContext })`,
      '  } catch {',
      '    // A throwing observer must never fail the request it watched.',
      '  }',
      '  return response',
      '}',
    )
  }
  lines.push(
    `const ${dispatchName} = (request${hooked ? ', locals' : ''}${extraArguments}) => {`,
    // One locals bag per request — hooked builds it in the wrapper (gates run
    // first), unhooked here — so every consumer (context factory, handler,
    // error formatters, observers) shares one object, like the runtime's
    // single ApiRequest.
    ...(hooked ? [] : ['  const locals = {}']),
    '  const url = request.url',
    "  const schemeEnd = url.indexOf('://')",
    "  const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)",
    "  const queryIndex = pathStart === -1 ? -1 : url.indexOf('?', pathStart)",
    "  const rawPath = pathStart === -1 ? '/' : queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex)",
    '  const method = request.method',
    ...(observeUnmatchedExport === undefined ? [] : ['  const missStart = performance.now()']),
  )
  for (const [prefix, exportName] of mounts) {
    // Mounts get the platform arguments (Better Auth on Workers reads secrets
    // from env); their presence forced needsPlatform, so env/executionContext
    // are in scope here.
    lines.push(
      `  if (rawPath === ${JSON.stringify(prefix)} || rawPath.startsWith(${JSON.stringify(prefix + '/')})) return ${exportName}(request, env, executionContext)`,
    )
  }
  if (openApiPath !== undefined) {
    lines.push(`  if ((method === 'GET' || method === 'HEAD') && rawPath === ${JSON.stringify(openApiPath)}) {`)
    if (openApiGuarded) {
      // Gated: the document endpoint answers only once every document guard
      // has passed. Its presence forced needsPlatform, so the platform
      // arguments the gate hands the context factory are in scope here.
      lines.push(`    return guardedOpenApi(method, ${ERROR_ARGS}, env, executionContext)`)
    } else {
      lines.push(
        // A matching validator answers 304 with no body — the document string
        // is embedded and immutable, so revalidation is a header compare.
        "    const ifNoneMatch = request.headers.get('if-none-match')",
        '    if (ifNoneMatch !== null && openApiEtagMatches(ifNoneMatch)) return new Response(null, { status: 304, headers: OPENAPI_304_HEADERS })',
        "    return method === 'HEAD' ? new Response(null, { status: 200, headers: OPENAPI_HEADERS }) : new Response(OPENAPI_JSON, { status: 200, headers: OPENAPI_HEADERS })",
      )
    }
    lines.push('  }')
  }
  lines.push("  const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath")

  const methods = [...new Set(routes.map((route) => route.method))]
  for (const method of methods) {
    const group = routes.filter((route) => route.method === method)
    const statics = group.filter((route) => route.isStatic)
    const dynamics = group.filter((route) => !route.isStatic)
    // No return at the end of the block: an unmatched method falls through to
    // the shared 405/404 tail below, like the runtime pipeline.
    lines.push(`  if (method === ${JSON.stringify(method)}) {`)
    for (const route of statics) {
      lines.push(
        `    if (path === ${JSON.stringify(route.staticPath)}) return ${invoke(route, `route_${route.name}(request, url, rawPath, queryIndex, locals${extraArguments})`)}`,
      )
    }
    if (dynamics.length > 0) {
      lines.push("    const segments = path === '/' ? [] : path.slice(1).split('/')")
      for (const route of dynamics) {
        const { conditions, captures } = dynamicMatch(route, 'segments')
        lines.push(
          `    if (${conditions.join(' && ')}) return ${invoke(route, `route_${route.name}(request, url, rawPath, queryIndex, locals${extraArguments}, ${captures.join(', ')})`)}`,
        )
      }
    }
    lines.push('  }')
  }

  // HEAD falls back to the GET routes with the reply body stripped (RFC
  // 9110), exactly like the runtime pipeline. Explicitly declared HEAD routes
  // won above: their method block already returned on a match.
  lines.unshift(
    'const stripHeadBody = (response) => {',
    '  if (response.body !== null) void response.body.cancel().catch(() => undefined)',
    '  return new Response(null, { status: response.status, headers: response.headers })',
    '}',
  )
  const gets = routes.filter((route) => route.method === 'GET')
  if (gets.length > 0) {
    lines.unshift(
      "const headOf = (reply) => (typeof reply?.then === 'function' ? reply.then(stripHeadBody) : stripHeadBody(reply))",
    )
    lines.push("  if (method === 'HEAD') {")
    for (const route of gets.filter((entry) => entry.isStatic)) {
      lines.push(
        `    if (path === ${JSON.stringify(route.staticPath)}) return headOf(${invoke(route, `route_${route.name}(request, url, rawPath, queryIndex, locals${extraArguments})`)})`,
      )
    }
    const dynamicGets = gets.filter((entry) => !entry.isStatic)
    if (dynamicGets.length > 0) {
      lines.push("    const segments = path === '/' ? [] : path.slice(1).split('/')")
      for (const route of dynamicGets) {
        const { conditions, captures } = dynamicMatch(route, 'segments')
        lines.push(
          `    if (${conditions.join(' && ')}) return headOf(${invoke(route, `route_${route.name}(request, url, rawPath, queryIndex, locals${extraArguments}, ${captures.join(', ')})`)})`,
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
      const conditions = dynamicMatch(route, 'allowSegments').conditions
      conditions.push(`!allow.includes(${JSON.stringify(route.method)})`)
      lines.push(`  if (${conditions.join(' && ')}) allow.push(${JSON.stringify(route.method)})`)
    }
  }
  lines.push(
    // GET routes implicitly serve HEAD (see the fallback block), so the allow
    // list advertises it whenever GET appears — same as the runtime pipeline.
    // HEAD 405s/404s are stripped like every HEAD reply the fetch adapter
    // sends: same status and headers, no body.
    "  if (allow.includes('GET') && !allow.includes('HEAD')) allow.push('HEAD')",
  )
  // The unmatched observer fires on the shaped miss (the status the client
  // will see), before HEAD body stripping — same order as the runtime.
  const miss = (expression: string): string =>
    observeUnmatchedExport === undefined
      ? expression
      : `observedMiss(${expression}, ${ERROR_ARGS}, env, executionContext, missStart)`
  lines.push(
    '  if (allow.length > 0) {',
    // The server genuinely serves OPTIONS for known paths (the 204 below),
    // so it joins every allow list; the guard covers paths with an explicit
    // options route already collected by the scan.
    "    if (!allow.includes('OPTIONS')) allow.push('OPTIONS')",
    '    allow.sort()',
    // A plain OPTIONS on a path served under other methods answers 204 with
    // the allow list — same rule as the runtime pipeline; an explicitly
    // declared options route matched in its method block above.
    `    if (method === 'OPTIONS') return ${miss("new Response(null, { status: 204, headers: { allow: allow.join(', ') } })")}`,
    `    const denied = ${miss(`methodNotAllowed(allow, ${ERROR_ARGS})`)}`,
    "    return method === 'HEAD' ? stripHeadBody(denied) : denied",
    '  }',
    `  const missing = ${miss(`notFound(${ERROR_ARGS})`)}`,
    "  return method === 'HEAD' ? stripHeadBody(missing) : missing",
    '}',
  )
  if (!hooked) {
    // The dispatch is deliberately not `async` — the sync-reply fast path
    // skips the promise and the microtask turn — so a synchronous throw
    // inside it would leave a function every fetch runtime treats as
    // `Promise<Response>` by throwing rather than rejecting. A mount can do
    // that (its contract admits a plain `Response`), and so can a `notFound` /
    // `methodNotAllowed` formatter, which runs before any promise exists.
    // The runtime engine wraps `dispatch` the same way, so both engines hand
    // such a failure to the platform in the identical shape.
    lines.push(
      `export const fetch = (request${extraArguments}) => {`,
      '  try {',
      `    return ${dispatchName}(request${extraArguments})`,
      '  } catch (error) {',
      '    return Promise.reject(error)',
      '  }',
      '}',
    )
  }

  if (!hooked) return lines

  // The emitted twin of `toFetchHandler`'s `hookError`: a thrown hook is
  // reported through the app's own `onError` (with `route: undefined` — a hook
  // belongs to no route), and falls back to `console.error` when the app wired
  // none. Dropping it would leave the CRLF-request-id failure the chains were
  // wrapped for completely undiagnosable, which is worse than the platform-level
  // crash the wrapping replaced.
  lines.push('const hookError = (error, request, locals, env, executionContext) => {')
  if (onErrorExport !== undefined) {
    // The URL is re-sliced here rather than threaded down from the dispatch:
    // the wrapper runs before it, and this is a once-per-500 cold path. Same
    // slicing as the dispatch, so both engines report the identical `path`.
    lines.push(
      '  try {',
      '    const url = request.url',
      "    const schemeEnd = url.indexOf('://')",
      "    const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)",
      "    const queryIndex = pathStart === -1 ? -1 : url.indexOf('?', pathStart)",
      "    const rawPath = pathStart === -1 ? '/' : queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex)",
      `    return toResponse(${onErrorExport}(error, makeApiRequest(request, url, rawPath, queryIndex, locals), { route: undefined, env, executionContext }))`,
      '  } catch {',
      '    // Reporting failed; fall through to the log and the bare 500.',
      '  }',
    )
  }
  lines.push(`  console.error(${JSON.stringify(HOOK_ERROR_MESSAGE)}, error)`, '  return internalError()', '}')

  // The hook wrapper: gates in order (first Response wins), then dispatch,
  // and every outcome — short-circuit, mount, routed reply, 404 — through the
  // decorators. Identical semantics to toFetchHandler's chains.
  if (onResponseExports.length > 0) {
    // The try/catch is the emitted twin of the fetch adapter's: a decorator
    // throwing (a reflected request id with a CRLF in it, say) must become the
    // pipeline's own reported 500 rather than escaping to the platform, and the
    // chain is abandoned at the first failure so the remaining decorators never
    // run over a half-decorated response. One try around the whole chain is
    // observationally identical to one per hook, since the catch abandons it.
    lines.push(
      'const finishResponse = async (response, request, locals, env, executionContext) => {',
      '  let current = response',
      '  let next',
      '  try {',
    )
    for (const name of onResponseExports) {
      lines.push(`    next = await ${name}(current, request, locals)`, '    if (next !== undefined) current = next')
    }
    lines.push(
      '  } catch (error) {',
      '    return hookError(error, request, locals, env, executionContext)',
      '  }',
      '  return current',
      '}',
    )
  }
  const finish = (expression: string): string =>
    onResponseExports.length > 0 ? `finishResponse(${expression}, request, locals, env, executionContext)` : expression
  lines.push(
    'export const fetch = async (request, env, executionContext) => {',
    // The shared per-request bag, created before the first gate so gates,
    // pipeline, and decorators all see the same object.
    '  const locals = {}',
  )
  if (onRequestExports.length > 0) {
    // A gate is app code with no boundary above it, so a throw here would reach
    // the platform instead of the pipeline. Its 500 still flows through the
    // decorators, exactly like a Response a gate returns on purpose.
    lines.push('  let early')
    for (const name of onRequestExports) {
      lines.push(
        '  try {',
        `    early = await ${name}(request, env, executionContext, locals)`,
        '  } catch (error) {',
        `    return ${finish('hookError(error, request, locals, env, executionContext)')}`,
        '  }',
        `  if (early !== undefined) return ${finish('early')}`,
      )
    }
  }
  lines.push(
    `  return ${finish(`await mjstHandleFetch(request, locals${emitContext.needsPlatform ? ', env, executionContext' : ''})`)}`,
    '}',
  )
  return lines
}
