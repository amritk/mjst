import { raw } from './raw'
import { switchingProtocols } from './switching-protocols'
import type { ApiRequest, RawReply } from './types'

/**
 * The slice of Bun's `Server` this helper needs. Typed structurally rather
 * than imported from `bun-types` so the package keeps its single dependency
 * and still type-checks in a Workers or Node build.
 */
export type WebSocketUpgrader = {
  upgrade: (request: Request, options?: { data?: unknown; headers?: UpgradeHeaders }) => boolean
}

/**
 * Headers accepted on the handshake response. Spelled out rather than reusing
 * `HeadersInit`, which the DOM lib provides and this package's `lib: ESNext`
 * setup does not.
 */
export type UpgradeHeaders = Headers | Record<string, string> | readonly (readonly [string, string])[]

/**
 * Options forwarded to `server.upgrade`.
 */
export type UpgradeWebSocketOptions = {
  /**
   * Attached to the socket as `ws.data` — how a route's validated `params` and
   * the app `context`'s resolved session reach the `websocket` handlers, which
   * run outside the request and can no longer see either.
   */
  readonly data?: unknown
  /** Extra headers to send on the handshake response (a `set-cookie`, say). */
  readonly headers?: UpgradeHeaders
}

/**
 * Upgrades a routed request to a WebSocket on Bun, returning the reply to hand
 * back from the handler — or `undefined` when the runtime refused the upgrade,
 * which the route answers with its own declared status.
 *
 * The `undefined` arm is not a formality. Bun's HTTP/3 listener does not
 * implement RFC 9220 WebSocket bootstrapping, so `server.upgrade()` returns
 * `false` for every request that arrived over HTTP/3 — with `http3: true` set,
 * the *same route* succeeds over TCP and is refused over QUIC, decided by
 * which transport the client happened to pick. Forcing the caller to supply
 * the refusal keeps that outcome in the contract and in the OpenAPI document
 * instead of collapsing to a 500:
 *
 * ```typescript
 * const chat = route({
 *   method: 'get',
 *   path: '/ws/{room}',
 *   request: { params: roomParams },
 *   responses: { 426: {} },
 *   handler: ({ params, request, context }) =>
 *     upgradeWebSocket(context.server, request, { data: { room: params.room } }) ??
 *     { status: 426 as const },
 * })
 * ```
 *
 * The status carries the whole signal, and that is not a simplification worth
 * undoing. RFC 9110 suggests pairing a 426 with `upgrade:` and `connection:`
 * headers naming the protocol to retry, but both are connection-specific
 * headers that HTTP/2 and HTTP/3 forbid (RFC 9114 section 4.2), so an H3
 * listener strips them on the way out — measured against Bun 1.4, where the
 * same route returns those headers over TCP and a bare 426 over QUIC. A
 * client that reads the headers therefore learns nothing in exactly the case
 * they were added for. `connectRealtime` treats any non-101 as "fall back",
 * which needs no header at all.
 *
 * Everything the route declares still applies to the handshake, because the
 * handshake *is* an ordinary routed request: path params are validated and
 * coerced, guards run, and `onRequest` gates (rate limits, origin checks) have
 * already had their say. That is the part worth having — an upgrade that
 * skipped the contract would be a hole in every policy the app configured.
 *
 * Nothing here inspects the `upgrade:` request header. Over HTTP/1.1 a
 * handshake carries one, but the HTTP/2 and HTTP/3 bootstraps (RFC 8441, RFC
 * 9220) replace it with an extended `CONNECT` and no such header exists —
 * rejecting on its absence would hard-code the framework to HTTP/1.1. Whether
 * the handshake is well formed is the runtime's call, reported through the
 * return value.
 */
export const upgradeWebSocket = (
  server: WebSocketUpgrader,
  request: ApiRequest,
  options?: UpgradeWebSocketOptions,
): RawReply | undefined => (server.upgrade(request.raw as Request, options) ? raw(switchingProtocols()) : undefined)
