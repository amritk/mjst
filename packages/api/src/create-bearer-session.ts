/**
 * The fetch shape this wrapper both consumes and produces — the same signature
 * `createClient`'s `fetch` option accepts, so a wrapped fetch drops straight in.
 */
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

/**
 * Where the session token lives between calls, and between app launches.
 *
 * Every method may be synchronous or asynchronous, because the storage that
 * matters here usually is not synchronous: `expo-secure-store` and the iOS/
 * Android keychains are all promise-based, while a `localStorage` shim is not.
 * Both satisfy this type as written.
 */
export type BearerTokenStorage = {
  /** Reads the stored token, or `undefined` when there is no session yet. */
  readonly get: () => string | undefined | Promise<string | undefined>
  /** Persists a newly issued or rotated token. */
  readonly set: (token: string) => void | Promise<void>
  /** Removes the stored token — sign-out, or a session the server has dropped. */
  readonly clear: () => void | Promise<void>
}

/**
 * Options for {@link createBearerSession}.
 */
export type BearerSessionOptions = {
  /**
   * Where to keep the token. This is the one required option, and it is
   * deliberately not defaulted: the right place is platform-specific, and a
   * silent fallback to in-memory storage would look like it worked until the
   * app relaunched and every user was signed out.
   *
   * **Choosing it is a security decision.** This token is a live session — hold
   * it where the platform protects it (`expo-secure-store`, the iOS keychain,
   * Android's `EncryptedSharedPreferences`). `localStorage` and
   * `AsyncStorage` are readable by any script or process that gets in, which
   * turns one XSS or one rooted device into a stolen session; if you are on the
   * web, the cookie models are the safer choice precisely because `HttpOnly`
   * keeps the credential out of reach of scripts.
   */
  readonly storage: BearerTokenStorage
  /**
   * The fetch to wrap. Defaults to the global `fetch`. Injectable for tests or
   * to compose with another wrapper.
   */
  readonly fetch?: FetchImpl
  /**
   * Response header carrying a newly issued or rotated token, captured and
   * persisted automatically. Defaults to `set-auth-token`, which is what Better
   * Auth's `bearer()` plugin sends; change it to match whatever your server
   * emits.
   *
   * Because this is captured from whatever replies, point the wrapped fetch at
   * **your API only**. Reuse it for arbitrary hosts and any one of them can
   * overwrite the stored session by answering with this header — the wrapper
   * trusts the responses it is shown, so scope it the way you would scope a
   * credential.
   */
  readonly tokenHeader?: string
  /**
   * Builds the request headers from the stored token. Defaults to
   * `{ authorization: `Bearer ${token}` }`. Override it for an `x-api-key`
   * scheme or any other placement.
   */
  readonly header?: (token: string) => Readonly<Record<string, string>>
  /**
   * Decides whether a response means the session is no longer accepted.
   * Defaults to `response.status === 401`. Override for APIs that signal expiry
   * with `403` or a custom body.
   */
  readonly isExpired?: (response: Response) => boolean
  /**
   * Renews the session explicitly, resolving to the new token. Optional,
   * because a server-held session usually needs nothing here: Better Auth's
   * token is opaque and stable, and a request arriving past `updateAge` rolls
   * the expiry forward in the database rather than issuing a replacement. For
   * that model, sending the token *is* the renewal.
   *
   * Supply this only when renewal is a real request. It is single-flighted
   * across concurrent callers, and the triggering request replays exactly once.
   * Resolve to `undefined` (or reject) to say the session is genuinely gone,
   * which clears the token and notifies
   * {@link BearerSessionOptions.onExpired}.
   */
  readonly refresh?: () => Promise<string | undefined>
  /**
   * Called after the stored token has been cleared because the server stopped
   * accepting it. This is the app's cue to route back to sign-in — there is no
   * silent recovery from here, since a magic-link session can only be replaced
   * by another sign-in.
   */
  readonly onExpired?: () => void
  /**
   * Notified when `refresh` throws, or when writing to storage fails. Neither
   * is fatal: the failing response is still returned to the caller, and a token
   * that could not be persisted is still used for the rest of this session.
   */
  readonly onError?: (error: unknown) => void
}

/**
 * The handle {@link createBearerSession} returns.
 */
export type BearerSession = {
  /**
   * The fetch to hand to `createClient({ fetch })`. It attaches the stored
   * token, captures any rotated one off the reply, and handles expiry.
   */
  readonly fetch: FetchImpl
  /** The token currently held, or `undefined` when there is no session. */
  readonly token: () => Promise<string | undefined>
  /** Stores a token obtained outside this wrapper — a sign-in response, say. */
  readonly set: (token: string) => Promise<void>
  /** Drops the stored token. Call it on sign-out. */
  readonly clear: () => Promise<void>
}

/**
 * Client-side session handling for the **bearer-token** model, built for
 * clients with no cookie jar — native apps above all, where a magic-link
 * sign-in hands back a token rather than a `Set-Cookie` the platform would
 * store and re-attach for you.
 *
 * It owns the whole round trip through one seam, `createClient({ fetch })`:
 *
 * - **Attach.** Every request goes out carrying the stored token. For a
 *   server-held session this is also the whole of "refresh": Better Auth and
 *   friends roll a session's expiry forward when a request arrives past
 *   `updateAge`, keeping the same token, so traffic alone keeps it alive.
 * - **Capture.** Every reply is checked for
 *   {@link BearerSessionOptions.tokenHeader}, and a token found there is
 *   persisted. That is how a token lands in storage when sign-in runs through
 *   this fetch, and it picks up a replacement from a server that does issue
 *   one — but do not count on it arriving per request.
 * - **Renew or surrender.** A reply that {@link BearerSessionOptions.isExpired}
 *   flags either runs {@link BearerSessionOptions.refresh} and replays once, or
 *   — with no `refresh` configured — clears the token and calls
 *   {@link BearerSessionOptions.onExpired} so the app can send the user back to
 *   sign-in.
 *
 * Why this is a fetch wrapper rather than a `headers` provider like
 * {@link createTokenRefresh}: only the fetch seam can see responses, and both
 * halves of the bearer model need them — the rotated token arrives on one, and
 * the replay after a renewal has to go out under the *new* token. That last part
 * is the trap this exists to close. {@link createRefreshFetch} can replay an
 * untouched `RequestInit` because the browser re-attaches the freshly
 * `Set-Cookie`'d session itself; here nothing does, so a replay reusing the
 * original init would present the same dead token and 401 again.
 *
 * Sign-in itself usually runs through your auth vendor's own client rather than
 * this one. Point that client at this `fetch` and the token is captured like any
 * other; otherwise read it from the sign-in response and hand it to
 * {@link BearerSession.set}.
 *
 * @example
 * ```typescript
 * import * as SecureStore from 'expo-secure-store'
 *
 * const session = createBearerSession({
 *   storage: {
 *     get: async () => (await SecureStore.getItemAsync('session')) ?? undefined,
 *     set: (token) => SecureStore.setItemAsync('session', token),
 *     clear: () => SecureStore.deleteItemAsync('session'),
 *   },
 *   onExpired: () => router.replace('/sign-in'),
 * })
 *
 * const client = createClient(contracts, 'https://api.example.com', { fetch: session.fetch })
 * // after a magic-link deep link resolves: session.set(token)
 * // on sign-out: session.clear()
 * ```
 */
export const createBearerSession = (options: BearerSessionOptions): BearerSession => {
  const fetchImpl = options.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init))
  const tokenHeader = options.tokenHeader ?? 'set-auth-token'
  const buildHeader = options.header ?? ((token: string) => ({ authorization: `Bearer ${token}` }))
  const isExpired = options.isExpired ?? ((response: Response) => response.status === 401)
  const { storage, refresh, onExpired, onError } = options

  // An in-memory mirror of the stored token, so the steady state costs no
  // storage round-trip per request — on a keychain-backed store that would be a
  // real await on the hot path.
  let cached: string | undefined
  let loaded = false
  // Single-flight guard for the very first read, so an app that fires several
  // requests at launch hits storage once rather than once per request.
  let loading: Promise<string | undefined> | null = null

  const report = (error: unknown): void => {
    if (onError !== undefined) onError(error)
  }

  const read = (): Promise<string | undefined> => {
    if (loaded) return Promise.resolve(cached)
    if (loading !== null) return loading
    loading = Promise.resolve(storage.get())
      .then((token) => {
        cached = token ?? undefined
        loaded = true
        return cached
      })
      .catch((error: unknown) => {
        // An unreadable store is a signed-out client, not a broken one. Mark it
        // loaded so we do not retry the failing read on every single request.
        report(error)
        cached = undefined
        loaded = true
        return undefined
      })
      .finally(() => {
        loading = null
      })
    return loading
  }

  /**
   * Updates the mirror first and persists after, so a storage failure costs the
   * durability of the token but never the request in flight.
   */
  const write = async (token: string): Promise<void> => {
    cached = token
    loaded = true
    try {
      await storage.set(token)
    } catch (error) {
      report(error)
    }
  }

  const drop = async (): Promise<void> => {
    cached = undefined
    loaded = true
    try {
      await storage.clear()
    } catch (error) {
      report(error)
    }
  }

  const surrender = async (): Promise<void> => {
    await drop()
    if (onExpired !== undefined) onExpired()
  }

  const withAuth = (init: RequestInit, token: string | undefined): RequestInit => {
    if (token === undefined) return init
    // Normalizing through `Headers` covers all three shapes `RequestInit.headers`
    // accepts, and `set` (not `append`) is what makes the replay below correct —
    // it overwrites the dead token instead of sending both.
    const headers = new Headers(init.headers)
    for (const [name, value] of Object.entries(buildHeader(token))) headers.set(name, value)
    return { ...init, headers }
  }

  const capture = async (response: Response): Promise<void> => {
    const issued = response.headers.get(tokenHeader)
    // An empty value is the server saying nothing, not a token worth storing.
    if (issued !== null && issued !== '') await write(issued)
  }

  // Single-flight guard: non-null while a renewal is in flight, so concurrent
  // expiries share one round-trip instead of each calling `refresh`.
  let inFlight: Promise<string | undefined> | null = null
  const runRefresh = (renew: () => Promise<string | undefined>): Promise<string | undefined> => {
    if (inFlight !== null) return inFlight
    inFlight = Promise.resolve(renew())
      .then(async (token) => {
        if (token !== undefined && token !== '') await write(token)
        return token
      })
      .finally(() => {
        // Cleared on success and failure alike, so a rejected renewal is not
        // cached and the next expiry gets a clean retry.
        inFlight = null
      })
    return inFlight
  }

  const wrapped: FetchImpl = async (url, init) => {
    const response = await fetchImpl(url, withAuth(init, await read()))
    await capture(response)
    if (!isExpired(response)) return response

    if (refresh === undefined) {
      await surrender()
      return response
    }

    let renewed: string | undefined
    try {
      renewed = await runRefresh(refresh)
    } catch (error) {
      report(error)
      await surrender()
      return response
    }
    if (renewed === undefined || renewed === '') {
      await surrender()
      return response
    }

    // Discard the unread body before replaying so no stream is left open.
    await response.body?.cancel().catch(() => undefined)
    // The replay is rebuilt around the new token rather than reusing `init`,
    // which still carries the dead one. See the note above on why the cookie
    // model gets away without this and the bearer model cannot.
    const replay = await fetchImpl(url, withAuth(init, renewed))
    await capture(replay)
    // Still refused after a successful renewal: the session is genuinely gone,
    // so hand back the reply rather than looping.
    if (isExpired(replay)) await surrender()
    return replay
  }

  return {
    fetch: wrapped,
    token: read,
    set: write,
    clear: drop,
  }
}
