import type { FetchOnRequest, FetchOnResponse } from './to-fetch-handler'
import type { RequestLocals } from './types'

/**
 * The counter a {@link RateLimitStore} returns for one hit: how many requests
 * the key has made in the current window, and when (epoch milliseconds) that
 * window resets. Kept minimal so a Redis/Durable-Object store is a thin
 * adapter over `INCR` + `PEXPIRE`.
 */
export type RateLimitState = {
  readonly count: number
  readonly resetAt: number
}

/**
 * Where hit counts live. The default is process-memory (fine for a single
 * instance); swap in a shared store — Redis, a Cloudflare Durable Object — to
 * rate-limit across a fleet. `hit` records one request against `key` for a
 * `windowMs`-long window and returns the running state.
 */
export type RateLimitStore = {
  readonly hit: (key: string, windowMs: number) => RateLimitState | Promise<RateLimitState>
}

/**
 * Options for {@link createRateLimit}.
 */
export type RateLimitOptions = {
  /** Requests allowed per key per window. */
  readonly limit: number
  /** Window length in milliseconds. */
  readonly windowMs: number
  /**
   * Derives the bucket key from the request. Defaults to the client IP read
   * from the usual proxy headers (`cf-connecting-ip`, `x-real-ip`, the first
   * `x-forwarded-for` hop), falling back to `'global'` when none is present —
   * so an unconfigured deployment behind no proxy shares one bucket rather
   * than silently not limiting. Override to key by API token, user id from
   * `locals`, or a route group.
   *
   * **Security note.** These headers are client-supplied: `x-forwarded-for`'s
   * first hop is fully attacker-controlled, and `cf-connecting-ip`/`x-real-ip`
   * can be spoofed by anything reaching the origin directly rather than through
   * the proxy that sets them. So the default trusts client input, and an
   * attacker rotating the header gets a fresh bucket per request. Only rely on
   * the default when a trusted proxy *overwrites* these headers and the origin
   * is not reachable around it. For a security throttle (login/brute-force),
   * key off a source you control — a proxy-verified client IP (rightmost
   * untrusted `x-forwarded-for` hop for your topology) or an authenticated user
   * id from `locals`.
   */
  readonly key?: (request: Request, locals: RequestLocals) => string
  /** Counter backend. Defaults to an in-process {@link RateLimitStore}. */
  readonly store?: RateLimitStore
  /**
   * Whether to advertise the `RateLimit-Limit`/`-Remaining`/`-Reset` headers
   * on allowed responses (they are always sent on the 429). Defaults to
   * `true`.
   */
  readonly headers?: boolean
  /**
   * Builds the 429 body as a string (typically JSON). Defaults to
   * `{ error: 'rate_limited' }`. `retryAfter` is whole seconds until the
   * window resets, already set as the `Retry-After` header.
   */
  readonly response?: (retryAfter: number, request: Request) => string
}

/**
 * The hook pair {@link createRateLimit} produces.
 */
export type RateLimit = {
  readonly onRequest: FetchOnRequest
  readonly onResponse: FetchOnResponse
}

const LOCALS_KEY = '__amritk.rateLimit'

type StampedHeaders = { readonly limit: number; readonly remaining: number; readonly reset: number }

// Hard ceiling on how many keys the in-memory store retains. A flood of
// distinct keys — trivial when the key derives from a spoofable header like
// `x-forwarded-for` — would otherwise grow the map without bound (memory
// exhaustion) and, since a sweep can only drop *expired* entries, turn every
// subsequent insert into a full O(n) scan that frees nothing (CPU exhaustion).
// When the map crosses `MAX_KEYS` it is trimmed back down to `TARGET_KEYS`, so
// the maintenance cost amortizes to O(1) per insert instead of running each
// time. Evicting a still-live counter under such a flood only grants that key a
// fresh window — strictly better than the unbounded growth it replaces, and the
// default store is already documented as single-instance (use a shared `store`
// for anything larger).
const MAX_KEYS = 100_000
const TARGET_KEYS = 90_000

/**
 * A process-memory {@link RateLimitStore} using fixed windows. Exported so a
 * test or a single-instance deployment can hold a reference (to clear it, say);
 * most callers just let {@link createRateLimit} default to a fresh one.
 *
 * Memory is bounded: the map is trimmed to {@link TARGET_KEYS} once it exceeds
 * {@link MAX_KEYS}, so a flood of distinct keys can neither exhaust memory nor
 * degrade the hot path to a per-request O(n) scan.
 */
export const memoryRateLimitStore = (): RateLimitStore => {
  const windows = new Map<string, RateLimitState>()
  const trim = (now: number): void => {
    // First drop entries whose window has already elapsed — cheap and lossless.
    for (const [candidate, value] of windows) {
      if (value.resetAt <= now) windows.delete(candidate)
    }
    // If still over budget the surplus is live keys (a distinct-key flood).
    // Evict oldest-inserted first, down to the target, so the trim amortizes.
    if (windows.size > TARGET_KEYS) {
      let excess = windows.size - TARGET_KEYS
      for (const candidate of windows.keys()) {
        windows.delete(candidate)
        if (--excess <= 0) break
      }
    }
  }
  return {
    hit: (key, windowMs) => {
      const now = Date.now()
      const existing = windows.get(key)
      if (existing === undefined || existing.resetAt <= now) {
        const state = { count: 1, resetAt: now + windowMs }
        windows.set(key, state)
        if (windows.size > MAX_KEYS) trim(now)
        return state
      }
      const state = { count: existing.count + 1, resetAt: existing.resetAt }
      windows.set(key, state)
      return state
    },
  }
}

const defaultKey = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ??
  request.headers.get('x-real-ip') ??
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  'global'

/**
 * Rate limiting as a hook pair — the `@fastify/rate-limit` / Django throttle /
 * Laravel `throttle` / Rack::Attack feature every framework here ships, over
 * the `onRequest` gate and `locals` seams. The gate counts the request and,
 * when the key is over its limit, short-circuits with a 429 carrying
 * `Retry-After` and the `RateLimit-*` headers; under the limit it stashes the
 * header values so the decorator can stamp them on the real response. Because
 * gate short-circuits still flow through `onResponse`, a 429 gets the app's
 * CORS and security headers like any other reply.
 *
 * The default store is in-process; pass a shared `store` for multi-instance
 * deployments. The default key is the client IP from proxy headers — override
 * it to limit by token or authenticated user.
 *
 * @example
 * ```typescript
 * const limit = createRateLimit({ limit: 100, windowMs: 60_000 })
 * const handler = toFetchHandler(api, {
 *   onRequest: [limit.onRequest],
 *   onResponse: [limit.onResponse],
 * })
 * ```
 */
export const createRateLimit = (options: RateLimitOptions): RateLimit => {
  const { limit, windowMs } = options
  const key = options.key ?? defaultKey
  const store = options.store ?? memoryRateLimitStore()
  const emitHeaders = options.headers ?? true
  const buildBody = options.response ?? (() => JSON.stringify({ error: 'rate_limited' }))

  const onRequest: FetchOnRequest = async (request, _env, _ctx, locals) => {
    const state = await store.hit(key(request, locals), windowMs)
    const remaining = Math.max(0, limit - state.count)
    const reset = Math.max(0, Math.ceil((state.resetAt - Date.now()) / 1000))
    if (state.count > limit) {
      const headers = new Headers({
        'retry-after': String(reset),
        'ratelimit-limit': String(limit),
        'ratelimit-remaining': '0',
        'ratelimit-reset': String(reset),
        'content-type': 'application/json; charset=utf-8',
      })
      return new Response(buildBody(reset, request), { status: 429, headers })
    }
    if (emitHeaders) {
      const stamped: StampedHeaders = { limit, remaining, reset }
      locals[LOCALS_KEY] = stamped
    }
    return undefined
  }

  const onResponse: FetchOnResponse = (response, _request, locals) => {
    const stamped = locals[LOCALS_KEY] as StampedHeaders | undefined
    if (stamped === undefined) return undefined
    response.headers.set('ratelimit-limit', String(stamped.limit))
    response.headers.set('ratelimit-remaining', String(stamped.remaining))
    response.headers.set('ratelimit-reset', String(stamped.reset))
    return undefined
  }

  return { onRequest, onResponse }
}
