import { raw } from './raw'
import { switchingProtocols } from './switching-protocols'
import type { RawReply } from './types'

/**
 * The slice of workerd's `WebSocket` a route touches after accepting one.
 * Typed structurally so the package pulls in no Workers types; the real object
 * carries the full `EventTarget` surface.
 */
export type ServerWebSocket = {
  accept: () => void
  send: (message: string | ArrayBuffer | ArrayBufferView) => void
  close: (code?: number, reason?: string) => void
  addEventListener: (type: string, listener: (event: never) => void) => void
}

/**
 * What {@link acceptWebSocket} hands back: the server end of the pair, already
 * accepted and ready to send, plus the reply the handler returns.
 */
export type AcceptedWebSocket = {
  /** The server end — attach `message` / `close` listeners to it. */
  readonly socket: ServerWebSocket
  /** The 101 reply carrying the client end. Return this from the handler. */
  readonly reply: RawReply
}

/**
 * Accepts a WebSocket on Cloudflare Workers, returning the server end plus the
 * 101 reply to hand back from the handler.
 *
 * This wraps two things the raw API gets wrong for callers. `WebSocketPair` is
 * an object keyed `0` and `1` rather than an array, so every codebase repeats
 * the same `Object.values` destructuring; and forgetting `server.accept()`
 * produces a connection that opens and then silently drops every message.
 *
 * ```typescript
 * const chat = route({
 *   method: 'get',
 *   path: '/ws/{room}',
 *   request: { params: roomParams },
 *   responses: { 426: {} },
 *   handler: ({ params }) => {
 *     const { socket, reply } = acceptWebSocket()
 *     socket.addEventListener('message', (event) => socket.send(`${params.room}: ${event.data}`))
 *     return reply
 *   },
 * })
 * ```
 *
 * Durable Objects are the other half of this on Workers: an isolate is not a
 * place to keep connection state, so a room's sockets belong to the object
 * that owns the room. Route the handshake here, then forward the request to
 * the Durable Object stub and return *its* response through `raw` instead.
 *
 * Throws when `WebSocketPair` is missing — that means the code is running
 * somewhere other than workerd, and a clear failure at the call site beats a
 * `ReferenceError` from inside the pipeline's error boundary. Bun has its own
 * upgrade path (see `upgradeWebSocket`); Deno's `upgradeWebSocket` already
 * returns a `Response`, so it needs no helper beyond `raw(response)`.
 */
export const acceptWebSocket = (): AcceptedWebSocket => {
  const pair = (globalThis as { WebSocketPair?: new () => Record<string, ServerWebSocket> }).WebSocketPair
  if (pair === undefined)
    throw new Error('acceptWebSocket() requires the Workers runtime: WebSocketPair is not defined')

  // Keyed '0' (client) and '1' (server), not an array — the one detail that
  // makes this API easy to get backwards. Sending the *server* end to the
  // client leaves both sides waiting on each other.
  const sockets = new pair()
  const client = sockets['0']
  const server = sockets['1']
  if (client === undefined || server === undefined) throw new Error('acceptWebSocket(): WebSocketPair returned no pair')

  server.accept()
  return { socket: server, reply: raw(switchingProtocols({ webSocket: client })) }
}
