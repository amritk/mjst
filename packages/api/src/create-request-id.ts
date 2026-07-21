import type { FetchOnRequest, FetchOnResponse } from './to-fetch-handler'
import type { RequestLocals } from './types'

/**
 * Options for {@link createRequestId}.
 */
export type RequestIdOptions = {
  /**
   * Header carrying the id, both inbound and outbound. Defaults to
   * `x-request-id` — the de-facto standard shared by Fastify, Fiber, and
   * most reverse proxies.
   */
  readonly header?: string
  /**
   * Where the id is stashed on {@link RequestLocals} for gates, the context
   * factory, and handlers to read. Defaults to `requestId`.
   */
  readonly localsKey?: string
  /**
   * Mints an id when the inbound header is absent (or untrusted). Defaults to
   * `crypto.randomUUID()`, available on every fetch runtime and Node ≥ 20.
   */
  readonly generate?: () => string
  /**
   * Whether to adopt a client-supplied id from the inbound header. Defaults
   * to `true` — propagating a caller's id is what makes a request traceable
   * across services. Set `false` at a trust boundary (a public edge) so a
   * client cannot forge or collide ids; a fresh one is always generated then.
   */
  readonly trustInbound?: boolean
}

/**
 * The hook pair {@link createRequestId} produces, ready to pass to
 * `toFetchHandler`.
 */
export type RequestId = {
  readonly onRequest: FetchOnRequest
  readonly onResponse: FetchOnResponse
}

/**
 * Correlation-id propagation as a hook pair. The gate resolves the id once —
 * adopting the inbound header when trusted, otherwise generating one — and
 * writes it to `locals` so the context factory, handlers, and `observe` can
 * put it on every log line. The decorator echoes it back on the response so
 * the caller (and any proxy in between) can stitch client and server logs
 * together. Every mainstream framework ships this; here it is fifteen lines
 * over the `locals` seam.
 *
 * @example
 * ```typescript
 * const requestId = createRequestId()
 * const api = createApi({
 *   routes,
 *   observe: ({ request, status, durationMs }) =>
 *     log.info({ id: request.locals?.requestId, status, durationMs }),
 * })
 * const handler = toFetchHandler(api, {
 *   onRequest: [requestId.onRequest],
 *   onResponse: [requestId.onResponse],
 * })
 * ```
 */
export const createRequestId = (options?: RequestIdOptions): RequestId => {
  const header = options?.header ?? 'x-request-id'
  const localsKey = options?.localsKey ?? 'requestId'
  const generate = options?.generate ?? (() => crypto.randomUUID())
  const trustInbound = options?.trustInbound ?? true

  const onRequest: FetchOnRequest = (request, _env, _ctx, locals) => {
    const inbound = trustInbound ? request.headers.get(header) : null
    const id = inbound !== null && inbound !== '' ? inbound : generate()
    locals[localsKey] = id
    return undefined
  }

  const onResponse: FetchOnResponse = (response, _request, locals) => {
    const id = locals[localsKey]
    // The gate always sets it; the guard covers a handler mounted with only
    // `onResponse` wired, where no gate ran.
    if (typeof id === 'string') response.headers.set(header, id)
    return undefined
  }

  return { onRequest, onResponse }
}

/**
 * Reads the id {@link createRequestId} stashed for this request, or
 * `undefined` if the gate did not run. A typed accessor so call sites do not
 * repeat the `localsKey` string or the `unknown` narrowing.
 */
export const getRequestId = (locals: RequestLocals | undefined, localsKey = 'requestId'): string | undefined => {
  const id = locals?.[localsKey]
  return typeof id === 'string' ? id : undefined
}
