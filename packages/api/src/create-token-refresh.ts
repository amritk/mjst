import { decodeJwtExpiry } from './decode-jwt-expiry'

/** setTimeout's 32-bit delay ceiling; a longer delay wraps and fires early. */
const MAX_TIMEOUT_DELAY = 2_147_483_647

/**
 * A token paired with when it stops being usable. `expiresAt` is epoch
 * milliseconds — the same clock as `Date.now()` — so the refresher can compare
 * it directly. JWT callers get this filled in for them (the `exp` claim is
 * decoded); opaque-token callers return it from `refresh` or supply a custom
 * `expiry`.
 */
export type AuthToken = {
  /** The bearer credential put on the wire. */
  readonly token: string
  /** When the token expires, in epoch milliseconds. */
  readonly expiresAt: number
}

/**
 * Options for {@link createTokenRefresh}.
 */
export type TokenRefreshOptions = {
  /**
   * Obtains a fresh credential. Receives the currently-held token (or
   * `undefined` on the very first fetch) — handy for rotation schemes that
   * present the old token. Return either a **JWT string** (its `exp` is
   * decoded automatically) or an explicit `{ token, expiresAt }` for opaque or
   * OAuth-style credentials whose lifetime lives outside the token (e.g.
   * `expires_in`). This is the one required option.
   */
  readonly refresh: (previous: AuthToken | undefined) => Promise<string | AuthToken>
  /**
   * A token to start with, so the first calls need no round-trip — a
   * server-rendered page's bootstrapped session, say. Omit it and the first
   * {@link TokenRefresh.headers} call blocks on `refresh`. A bare string is
   * treated as a JWT (or run through `expiry`).
   */
  readonly initial?: string | AuthToken
  /**
   * Derives `expiresAt` (epoch ms) from a token string when `refresh` returns
   * a string. Defaults to {@link decodeJwtExpiry}. Supply this for non-JWT
   * tokens that still carry their own expiry; for tokens whose expiry is not
   * embedded at all, return `{ token, expiresAt }` from `refresh` instead.
   */
  readonly expiry?: (token: string) => number
  /**
   * How long before `expiresAt` a token is considered stale enough to renew
   * ahead of time, in milliseconds. Defaults to `60_000` (one minute). Inside
   * this window a call still uses the current token but kicks off a background
   * refresh; only once the token is fully expired does a call block. Set it
   * large enough to comfortably cover a `refresh` round-trip plus clock skew.
   */
  readonly refreshBefore?: number
  /**
   * Whether to also renew on a timer while the client sits idle, so a token
   * never lapses even with no traffic to trigger the in-window refresh above.
   * Defaults to `true`. The timer is `unref`'d (it never keeps a Node process
   * alive) and cleared by {@link TokenRefresh.dispose}; turn it off for
   * short-lived serverless invocations that have nothing to keep warm.
   */
  readonly proactive?: boolean
  /**
   * Builds the request headers from the current token. Defaults to
   * `{ authorization: `Bearer ${token}` }`. Override it for an `x-api-key`
   * scheme or any other placement.
   */
  readonly header?: (token: string) => Readonly<Record<string, string>>
  /**
   * Notified when a **background** refresh (the in-window or timer path)
   * fails. Foreground failures reject the `headers()` promise and surface at
   * the call site instead; a background failure has no call site, so without
   * this it is swallowed. The stale token keeps being used until it expires,
   * at which point a call blocks and retries.
   */
  readonly onError?: (error: unknown) => void
  /**
   * Clock source, in epoch milliseconds. Defaults to `Date.now`. Injectable so
   * the refresh logic can be tested without wall-clock timing.
   */
  readonly now?: () => number
}

/**
 * The handle {@link createTokenRefresh} returns.
 */
export type TokenRefresh = {
  /**
   * The provider to hand straight to `createClient({ headers })`. Resolves the
   * auth headers for one request, blocking only when the token is fully
   * expired.
   */
  readonly headers: () => Promise<Readonly<Record<string, string>>>
  /** The token currently held, or `undefined` before the first refresh. */
  readonly token: () => AuthToken | undefined
  /**
   * Drops the current token so the next `headers()` call refreshes
   * unconditionally — for logout-then-relogin, or after a 401 tells you the
   * server rejected a token that still looked valid locally.
   */
  readonly invalidate: () => void
  /** Stops the background timer. Idempotent; safe to call from cleanup. */
  readonly dispose: () => void
}

/**
 * Client-side auth refresh over a single-flighted token, built to plug into
 * `createClient({ headers })`. One primitive drives both refresh paths we
 * want:
 *
 * - **Reactive (queued).** When a call finds the token expired it awaits a
 *   refresh, and because the in-flight refresh promise is shared, every
 *   concurrent call queues behind that *one* network round-trip and is
 *   released together with the new token — no thundering herd.
 * - **Proactive (seamless).** A token that is still valid but within
 *   `refreshBefore` of expiring is renewed in the background while the current
 *   call proceeds on the still-good token. Under traffic this happens for
 *   free; the optional idle timer covers an open-but-quiet client so the token
 *   never lapses either way.
 *
 * Expiry is the pivot both paths turn on. JWTs are zero-config — return the
 * string from `refresh` and its `exp` is decoded. Opaque or OAuth tokens
 * return `{ token, expiresAt }` (or set `expiry`) so any credential fits.
 *
 * This intentionally does **not** react to HTTP 401s — it renews on the
 * token's own clock. A server that revokes a token early (so it still looks
 * valid here) is handled by calling {@link TokenRefresh.invalidate} from your
 * 401 handling, which forces the next call to refresh.
 *
 * @example
 * ```typescript
 * const auth = createTokenRefresh({
 *   refresh: async () => (await fetch('/auth/refresh').then((r) => r.json())).accessToken, // a JWT
 * })
 * const client = createClient(contracts, 'https://api.example.com', { headers: auth.headers })
 * // ...on teardown: auth.dispose()
 * ```
 */
export const createTokenRefresh = (options: TokenRefreshOptions): TokenRefresh => {
  const expiry = options.expiry ?? decodeJwtExpiry
  const refreshBefore = options.refreshBefore ?? 60_000
  const proactive = options.proactive ?? true
  const buildHeader = options.header ?? ((token: string) => ({ authorization: `Bearer ${token}` }))
  const now = options.now ?? Date.now
  const onError = options.onError

  const normalize = (result: string | AuthToken): AuthToken =>
    typeof result === 'string' ? { token: result, expiresAt: expiry(result) } : result

  let current: AuthToken | undefined = options.initial === undefined ? undefined : normalize(options.initial)
  // Single-flight guard: non-null while a refresh is in flight, so concurrent
  // callers share it rather than each starting their own.
  let inFlight: Promise<AuthToken> | null = null
  // Bumped by `invalidate` (and `dispose`). A refresh captures the value when it
  // starts and only commits its result if the value is unchanged — so an
  // invalidation that lands mid-flight (a logout, or a 401 handler dropping the
  // token) is not clobbered by the in-flight refresh resurrecting a token.
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const reportError = (error: unknown): void => {
    if (onError !== undefined) onError(error)
  }

  /** Arms the idle timer to renew the current token as it enters its window. */
  const schedule = (): void => {
    clearTimer()
    if (!proactive || disposed || current === undefined) return
    const target = current.expiresAt - refreshBefore
    const delay = target - now()
    // Already at/inside the window (including a token issued short-lived enough
    // to start there): skip the timer so it can't drive a tight refresh loop.
    // The reactive path at hard expiry still renews such a token.
    if (delay <= 0) return
    timer = setTimeout(
      () => {
        // A delay past setTimeout's ceiling fired early; re-arm instead of
        // renewing before the token is actually due.
        if (now() >= target) void refresh().catch(reportError)
        else schedule()
      },
      Math.min(delay, MAX_TIMEOUT_DELAY),
    )
    // A refresh timer must never hold a process open on its own.
    timer.unref?.()
  }

  const refresh = (): Promise<AuthToken> => {
    if (inFlight !== null) return inFlight
    const startedAt = generation
    inFlight = Promise.resolve(options.refresh(current))
      .then((result) => {
        const token = normalize(result)
        // An `invalidate`/`dispose` landed while this refresh was in flight —
        // honor it and discard this now-stale token rather than resurrecting
        // one the caller deliberately dropped.
        if (generation !== startedAt) return token
        current = token
        schedule()
        return token
      })
      .finally(() => {
        // Cleared on success and failure alike: a rejected refresh is not
        // cached, so the next call gets a clean retry.
        inFlight = null
      })
    return inFlight
  }

  const headers = async (): Promise<Readonly<Record<string, string>>> => {
    const time = now()
    if (current === undefined || time >= current.expiresAt) {
      // No token yet, or fully expired: block until one is in hand.
      const fresh = await refresh()
      return buildHeader(fresh.token)
    }
    if (time >= current.expiresAt - refreshBefore) {
      // Inside the window but still valid: renew in the background and let this
      // call ride the current token so nothing waits.
      void refresh().catch(reportError)
    }
    return buildHeader(current.token)
  }

  // Arm the timer for a seeded initial token.
  schedule()

  return {
    headers,
    token: () => current,
    invalidate: () => {
      current = undefined
      // Bump so an in-flight refresh cannot commit its result over this.
      generation++
      clearTimer()
    },
    dispose: () => {
      disposed = true
      generation++
      clearTimer()
    },
  }
}
