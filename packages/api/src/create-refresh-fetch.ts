/**
 * The fetch shape this wrapper both consumes and produces — the same signature
 * `createClient`'s `fetch` option accepts, so a wrapped fetch drops straight in.
 */
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

/**
 * Options for {@link createRefreshFetch}.
 */
export type RefreshFetchOptions = {
  /**
   * Renews the session — typically a `POST /auth/refresh` that reads the
   * HttpOnly refresh cookie and `Set-Cookie`s a fresh access cookie. Called at
   * most once per triggering request, single-flighted across concurrent
   * callers. Reject (throw) to signal the session is truly gone; resolve on
   * success. Make this call the endpoint directly (not through the wrapped
   * fetch) so it never recurses, and include CSRF/credentials as your server
   * requires.
   */
  readonly refresh: () => Promise<unknown>
  /**
   * The fetch to wrap. Defaults to the global `fetch`. Injectable for tests or
   * to compose with another wrapper.
   */
  readonly fetch?: FetchImpl
  /**
   * Decides whether a response means "auth expired, try refreshing". Defaults
   * to `response.status === 401`. Override for APIs that signal expiry with
   * `403` or a custom body.
   */
  readonly shouldRefresh?: (response: Response) => boolean
  /**
   * Notified when {@link RefreshFetchOptions.refresh} throws. The original
   * failing response is returned to the caller regardless, so the app's normal
   * 401 handling still runs; this is just an observation hook.
   */
  readonly onRefreshError?: (error: unknown) => void
}

/**
 * Wraps a fetch so an expired session refreshes and the request replays once —
 * the reactive half of auth for the HttpOnly-cookie model, where the browser
 * holds no token and only needs to trigger a server-side renewal. Pair it with
 * `createClient({ fetch, fetchOptions: { credentials: 'include' } })`.
 *
 * On a response that {@link RefreshFetchOptions.shouldRefresh} flags (401 by
 * default) it runs `refresh` and retries the original request exactly once.
 * The refresh is **single-flighted**: a burst of calls that all 401 share one
 * renewal and each replay afterward — no stampede of refresh requests. The
 * retry carries the same `RequestInit`, so the browser attaches the freshly
 * `Set-Cookie`'d session automatically. It never retries more than once, so a
 * still-401 reply after refreshing (the session is genuinely gone) flows back
 * to the caller as a normal reply rather than looping.
 *
 * Because it renews on a real 401 from the server, this also covers the
 * early-revocation case that a purely expiry-clock refresher cannot see.
 *
 * The single retry reuses the original `init.body`. Bodies `createClient`
 * produces (JSON strings, `Blob`, `URLSearchParams`, `FormData`) replay fine;
 * a one-shot `ReadableStream` body cannot be re-sent and will not retry
 * correctly — stream uploads should handle their own re-auth.
 *
 * @example
 * ```typescript
 * const authFetch = createRefreshFetch({
 *   refresh: () => fetch('/auth/refresh', { method: 'POST', credentials: 'include' }),
 * })
 * const client = createClient(contracts, 'https://api.example.com', {
 *   fetch: authFetch,
 *   fetchOptions: { credentials: 'include' },
 *   headers: createCsrfHeader(), // echo the double-submit token on writes
 * })
 * ```
 */
export const createRefreshFetch = (options: RefreshFetchOptions): FetchImpl => {
  const fetchImpl = options.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init))
  const shouldRefresh = options.shouldRefresh ?? ((response: Response) => response.status === 401)
  const onRefreshError = options.onRefreshError

  // Single-flight guard: non-null while a refresh is in flight, so concurrent
  // 401s share one renewal instead of each hitting the refresh endpoint.
  let inFlight: Promise<unknown> | null = null
  const runRefresh = (): Promise<unknown> => {
    if (inFlight !== null) return inFlight
    inFlight = Promise.resolve(options.refresh()).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return async (url, init) => {
    const response = await fetchImpl(url, init)
    if (!shouldRefresh(response)) return response
    try {
      await runRefresh()
    } catch (error) {
      if (onRefreshError !== undefined) onRefreshError(error)
      // Refresh failed — the session is gone; hand back the original response
      // so the caller's normal 401 handling takes over.
      return response
    }
    // Discard the unread 401 body before replaying so no stream is left open.
    await response.body?.cancel().catch(() => undefined)
    return fetchImpl(url, init)
  }
}
