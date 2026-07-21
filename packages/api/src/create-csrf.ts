import type { FetchOnRequest, FetchOnResponse } from './to-fetch-handler'

/**
 * Options for {@link createCsrf}.
 */
export type CsrfOptions = {
  /** Cookie holding the token. Defaults to `csrf_token`. */
  readonly cookieName?: string
  /**
   * Header (or form field, read by the app) the client echoes the token in.
   * Defaults to `x-csrf-token`. The double-submit check compares this against
   * the cookie.
   */
  readonly headerName?: string
  /**
   * Methods treated as safe (no token required). Defaults to
   * `GET`/`HEAD`/`OPTIONS` per RFC 9110 — they must not mutate state.
   */
  readonly safeMethods?: readonly string[]
  /**
   * Attributes appended to the `Set-Cookie` line. Defaults to
   * `Path=/; SameSite=Lax`. The cookie is intentionally **not** `HttpOnly` —
   * the double-submit pattern needs page scripts to read it and echo it back.
   */
  readonly cookieAttributes?: string
  /** Mints a token. Defaults to `crypto.randomUUID()`. */
  readonly generate?: () => string
  /** Skips the check for a request (e.g. a bearer-token API path with no cookies). */
  readonly exempt?: (request: Request) => boolean
}

/**
 * The hook pair {@link createCsrf} produces.
 */
export type Csrf = {
  readonly onRequest: FetchOnRequest
  readonly onResponse: FetchOnResponse
}

const parseCookie = (header: string | null, name: string): string | undefined => {
  if (header === null) return undefined
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * Cross-site request forgery protection via the stateless double-submit cookie
 * pattern — the defense Rails, Laravel, Hono, and Fiber all ship. The gate
 * rejects an unsafe-method request whose `x-csrf-token` header does not match
 * its `csrf_token` cookie with a `403`; the decorator seeds the cookie on any
 * response that lacks it, so a freshly loaded page has a token to echo.
 *
 * Safe methods pass untouched, and `exempt` opts out paths that authenticate
 * by bearer token instead of cookies (where CSRF does not apply). Because the
 * token only needs to match itself, no server-side state is stored.
 *
 * @example
 * ```typescript
 * const csrf = createCsrf()
 * const handler = toFetchHandler(api, {
 *   onRequest: [csrf.onRequest],
 *   onResponse: [csrf.onResponse],
 * })
 * ```
 */
export const createCsrf = (options?: CsrfOptions): Csrf => {
  const cookieName = options?.cookieName ?? 'csrf_token'
  const headerName = options?.headerName ?? 'x-csrf-token'
  const safe = new Set(options?.safeMethods ?? ['GET', 'HEAD', 'OPTIONS'])
  const attributes = options?.cookieAttributes ?? 'Path=/; SameSite=Lax'
  const generate = options?.generate ?? (() => crypto.randomUUID())

  const onRequest: FetchOnRequest = (request) => {
    if (safe.has(request.method) || options?.exempt?.(request) === true) return undefined
    const cookieToken = parseCookie(request.headers.get('cookie'), cookieName)
    const headerToken = request.headers.get(headerName)
    // Both must be present and equal. A missing cookie means the client never
    // received a token (or stripped it) — treat it as a failure, not a bypass.
    if (cookieToken === undefined || headerToken === null || cookieToken !== headerToken) {
      return new Response(JSON.stringify({ error: 'csrf_failed' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    }
    return undefined
  }

  const onResponse: FetchOnResponse = (response, request) => {
    // Seed a token whenever the request arrived without one, so the next
    // unsafe request has something to echo.
    if (parseCookie(request.headers.get('cookie'), cookieName) === undefined) {
      response.headers.append('set-cookie', `${cookieName}=${generate()}; ${attributes}`)
    }
    return undefined
  }

  return { onRequest, onResponse }
}
