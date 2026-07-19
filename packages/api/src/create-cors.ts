import type { FetchOnRequest, FetchOnResponse } from './to-fetch-handler'

/**
 * CORS behavior for {@link createCors}. The shape mirrors the common
 * middleware options (hono/cors, expressjs/cors) so configurations port over
 * directly.
 */
export type CorsOptions = {
  /**
   * Which origins may call the API: `'*'` for anyone, an exact origin, a
   * list, or a function deciding per request (return the origin value to
   * allow — usually the input itself — or `undefined` to deny). Note the
   * spec forbids `'*'` together with `credentials` — {@link createCors}
   * throws on that combination; use a function that reflects the origin
   * instead.
   */
  readonly origin: '*' | string | readonly string[] | ((origin: string, request: Request) => string | undefined)
  /** Methods advertised on preflight. Defaults to the common full set. */
  readonly allowMethods?: readonly string[]
  /**
   * Request headers advertised on preflight. When unset, the browser's
   * `access-control-request-headers` is reflected back — allow whatever was
   * asked — which is what most same-team frontends want.
   */
  readonly allowHeaders?: readonly string[]
  /** Response headers the browser may expose to page scripts. */
  readonly exposeHeaders?: readonly string[]
  /** Sends `access-control-allow-credentials: true` (cookies, TLS auth). */
  readonly credentials?: boolean
  /** Preflight cache lifetime in seconds (`access-control-max-age`). */
  readonly maxAge?: number
}

/**
 * The two hooks CORS needs, ready to pass to `toFetchHandler` (or list among
 * other hooks): `onRequest` answers preflights before routing, `onResponse`
 * stamps the allow/expose headers on every outgoing response.
 */
export type Cors = {
  readonly onRequest: FetchOnRequest
  readonly onResponse: FetchOnResponse
}

const DEFAULT_METHODS = 'GET,HEAD,PUT,POST,DELETE,PATCH'

/**
 * Builds CORS as a hook pair instead of a routing feature: preflights are
 * answered for any path (the browser sends them before it can know whether
 * the route exists), and decoration applies to every response — including
 * 404s and gate short-circuits — because a browser drops any reply lacking
 * the allow-origin header, error or not.
 *
 * Throws when the static origin config is the `'*'` wildcard combined with
 * `credentials: true` — the Fetch spec forbids that pair and every browser
 * rejects it, so failing at setup beats shipping CORS headers no browser
 * will honor. A function-typed `origin` cannot be checked statically and is
 * trusted as written.
 *
 * @example
 * ```typescript
 * const cors = createCors({ origin: (o) => o, credentials: true, exposeHeaders: ['x-demo-used'] })
 * const handler = toFetchHandler(api, { onRequest: [cors.onRequest], onResponse: [cors.onResponse] })
 * ```
 */
export const createCors = (options: CorsOptions): Cors => {
  if (options.credentials === true && originAllowsWildcard(options.origin)) {
    throw new Error(
      "CORS: `origin: '*'` cannot be combined with `credentials: true` — browsers reject a wildcard " +
        'allow-origin on credentialed requests. Reflect the request origin with a function instead, ' +
        'e.g. `origin: (origin) => origin`.',
    )
  }
  const resolve = toResolver(options.origin)
  // With a single fixed allowed origin the response headers never vary, so
  // they are computed once. `vary: origin` still matters for caches whenever
  // the allow-origin value is not the wildcard.
  const varies = options.origin !== '*'
  const allowMethods = options.allowMethods === undefined ? DEFAULT_METHODS : options.allowMethods.join(',')
  const allowHeaders = options.allowHeaders?.join(',')
  const exposeHeaders = options.exposeHeaders?.join(',')
  const credentials = options.credentials === true
  const maxAge = options.maxAge

  const onRequest: FetchOnRequest = (request) => {
    if (request.method !== 'OPTIONS') return undefined
    const origin = request.headers.get('origin')
    const requestedMethod = request.headers.get('access-control-request-method')
    // Not a preflight (a plain OPTIONS request) — let routing answer it.
    if (origin === null || requestedMethod === null) return undefined
    const allowed = resolve(origin, request)
    if (allowed === undefined) return undefined

    const headers = new Headers()
    headers.set('access-control-allow-origin', allowed)
    headers.set('access-control-allow-methods', allowMethods)
    const allowList = allowHeaders ?? request.headers.get('access-control-request-headers') ?? undefined
    if (allowList !== undefined && allowList !== '') headers.set('access-control-allow-headers', allowList)
    if (credentials) headers.set('access-control-allow-credentials', 'true')
    if (maxAge !== undefined) headers.set('access-control-max-age', String(maxAge))
    if (varies) headers.set('vary', 'origin, access-control-request-method, access-control-request-headers')
    return new Response(null, { status: 204, headers })
  }

  const onResponse: FetchOnResponse = (response, request) => {
    const origin = request.headers.get('origin')
    if (origin === null) return varies ? appendVary(response) : undefined
    const allowed = resolve(origin, request)
    if (allowed === undefined) return varies ? appendVary(response) : undefined

    const target = writable(response)
    target.headers.set('access-control-allow-origin', allowed)
    if (credentials) target.headers.set('access-control-allow-credentials', 'true')
    if (exposeHeaders !== undefined) target.headers.set('access-control-expose-headers', exposeHeaders)
    if (varies) appendVary(target)
    return target
  }

  return { onRequest, onResponse }
}

/**
 * Whether a static origin config resolves to the `'*'` wildcard — the literal
 * string, or a list containing it (a `'*'` entry in a list is a
 * misconfiguration too: it would only ever match a literal `origin: *` header,
 * which no browser sends, and it signals wildcard intent).
 */
const originAllowsWildcard = (origin: CorsOptions['origin']): boolean => {
  if (typeof origin === 'function') return false
  if (typeof origin === 'string') return origin === '*'
  return origin.includes('*')
}

const toResolver = (origin: CorsOptions['origin']): ((origin: string, request: Request) => string | undefined) => {
  if (typeof origin === 'function') return origin
  if (origin === '*') return () => '*'
  if (typeof origin === 'string') return (candidate) => (candidate === origin ? origin : undefined)
  const allowed = new Set(origin)
  return (candidate) => (allowed.has(candidate) ? candidate : undefined)
}

/**
 * Adds `origin` to the response's `vary` header without clobbering what a
 * handler already put there — a response that varies on both `origin` and,
 * say, `accept-encoding` must say so or shared caches will serve the wrong
 * copy.
 */
const appendVary = (response: Response): Response => {
  const target = writable(response)
  const existing = target.headers.get('vary')
  if (existing === null) {
    target.headers.set('vary', 'origin')
  } else if (
    existing !== '*' &&
    !existing
      .toLowerCase()
      .split(',')
      .some((value) => value.trim() === 'origin')
  ) {
    target.headers.set('vary', existing + ', origin')
  }
  return target
}

/**
 * Responses created by the adapters have mutable headers, but a `Response`
 * that came out of `fetch` (a proxying mount, say) is immutable — cloning
 * through the constructor is the documented way to get a writable copy.
 */
const writable = (response: Response): Response => {
  try {
    // Probing with a real mutation: there is no public flag for immutability.
    response.headers.append('x-amritk-probe', '1')
    response.headers.delete('x-amritk-probe')
    return response
  } catch {
    return new Response(response.body, response)
  }
}
