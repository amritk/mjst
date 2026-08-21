import type { MessageChannelOptions } from './message-channel'
import { assertOutbound, closeQuietly, createIngest } from './message-channel'
import type { AnyMessagesContract, ClientToServerMessage, ServerToClientMessage } from './message-contracts'
import { prepareMessages } from './message-contracts'

/**
 * The slice of a server-side socket this needs, typed structurally so one
 * function covers Bun's `ServerWebSocket`, workerd's `WebSocket`, and Deno's —
 * none of which share a type, and all of which have these two methods.
 */
export type BindableSocket = {
  send: (data: string) => unknown
  close: (code?: number, reason?: string) => unknown
  /** Present on workerd and Deno sockets, absent on Bun's. See {@link bindMessages}. */
  addEventListener?: (type: string, listener: (event: never) => void) => void
  /** How binary frames are delivered. Set to `'arraybuffer'` when present — see {@link bindMessages}. */
  binaryType?: string
}

/**
 * A contract-typed view of one connection, from the server's side.
 */
export type ServerMessageChannel<M extends AnyMessagesContract> = {
  /** Sends one `serverToClient` message. Serialization is handled here. */
  readonly send: (message: ServerToClientMessage<M>) => void
  /**
   * Hands one raw frame to the channel. Call this from whatever the runtime
   * gives you; on a socket with `addEventListener` it is already wired up.
   */
  readonly accept: (raw: string | Uint8Array) => void
  /** Validated `clientToServer` messages, in order. */
  readonly messages: AsyncIterableIterator<ClientToServerMessage<M>>
  /**
   * Binary frames, which no JSON contract describes. They are never contract
   * messages, but a peer may legitimately send them alongside — this is where
   * they arrive, rather than on the socket, which the channel is reading.
   *
   * Opt in with `receiveBinary`; without it this iterator has already ended,
   * so reading it finishes immediately rather than hanging. The queue below is
   * unbounded, and a stream nobody drains would grow until the connection
   * closed.
   */
  readonly binary: AsyncIterableIterator<Uint8Array>
  /** Ends iteration. Call from the runtime's close handler. */
  readonly end: (error?: unknown) => void
  /** Closes the connection and ends iteration. */
  readonly close: (code?: number, reason?: string) => void
}

/**
 * Wraps a server-side socket in its contract: validated inbound messages,
 * typed outbound ones.
 *
 * This is a wrapper rather than a pipeline stage because a socket outlives the
 * request that created it. By the time the first message arrives the handler
 * has returned, the `ApiRequest` is gone, and on Bun the message handler is not
 * even in the same function — it lives on `Bun.serve({ websocket })` and sees
 * only `ws.data`. There is no request to hang per-message validation off, so
 * the connection carries it instead.
 *
 * ```typescript
 * // Workers / Deno — the socket is an EventTarget, so frames are wired for you.
 * const { socket, reply } = acceptWebSocket()
 * const channel = bindMessages(chatMessages, socket)
 *
 * // Drive the loop *without* awaiting it. Nothing arrives until the client
 * // sees the 101, so awaiting the iteration here would hold the handshake
 * // response back and deadlock the connection that is meant to feed it.
 * void (async () => {
 *   for await (const message of channel.messages) {
 *     if (message.type === 'say') channel.send({ type: 'said', from: user, text: message.text })
 *   }
 * })().catch(report) // the iterator rejects when the transport fails
 *
 * return reply
 * ```
 *
 * ```typescript
 * // Bun — the socket does not exist until the upgrade completes, so the channel
 * // is built in `open` and stashed on `ws.data` for the other handlers. The
 * // route's `upgradeWebSocket(server, request, { data })` seeds that object
 * // with the request-scoped values (validated params, the session); it cannot
 * // carry the channel itself, since there is no socket to bind yet.
 * Bun.serve({
 *   websocket: {
 *     open: (ws) => {
 *       ws.data.channel = bindMessages(chatMessages, ws)
 *       void (async () => {
 *         for await (const message of ws.data.channel.messages) handle(ws.data.room, message)
 *       })().catch(report)
 *     },
 *     message: (ws, raw) => ws.data.channel.accept(raw),
 *     close: (ws) => ws.data.channel.end(),
 *   },
 * })
 * ```
 *
 * Inbound frames are validated against `clientToServer` — the half a server
 * cannot trust. Outbound `send` is typed at compile time and validated only
 * with `validateOutbound`, matching how `validateResponses` treats a handler's
 * own replies.
 */
export const bindMessages = <const M extends AnyMessagesContract>(
  contract: M,
  socket: BindableSocket,
  options?: MessageChannelOptions,
): ServerMessageChannel<M> => {
  const { discriminator, clientToServer, serverToClient } = prepareMessages(contract)

  const { accept, queue, binary } = createIngest<ClientToServerMessage<M>>(
    clientToServer,
    discriminator,
    options,
    (code, reason) => {
      queue.end()
      binary.end()
      closeQuietly(socket, code, reason)
    },
  )

  const endAll = (error?: unknown): void => {
    queue.end(error)
    binary.end(error)
  }

  // Deno's WHATWG socket defaults to `'blob'`, and a Blob only converts to
  // bytes asynchronously — which this listener cannot await — so every binary
  // frame would reach the app as an empty buffer, silently. `connectRealtime`
  // sets this on the client half for the same reason; leaving it unset here
  // made the two ends of `channel.binary` disagree. Guarded because some
  // runtimes expose the property read-only.
  try {
    if (socket.binaryType !== undefined && socket.binaryType !== 'arraybuffer') socket.binaryType = 'arraybuffer'
  } catch {
    // Read-only or unsupported; `toBytes` still handles what does arrive.
  }

  if (socket.addEventListener !== undefined) {
    socket.addEventListener('message', ((event: { data: unknown }) => {
      const data = event.data
      accept(typeof data === 'string' ? data : toBytes(data))
    }) as never)
    socket.addEventListener('close', (() => endAll()) as never)
    // A socket that errors without a following `close` — which runtimes differ
    // on — would otherwise leave every consumer parked on `messages` forever,
    // leaking one pending loop per connection.
    socket.addEventListener('error', (() => endAll()) as never)
  }

  const send = (message: ServerToClientMessage<M>): void => {
    if (options?.validateOutbound === true)
      assertOutbound(message, serverToClient, discriminator, 'bindMessages', 'serverToClient')
    socket.send(JSON.stringify(message))
  }

  return {
    send,
    accept,
    messages: queue.stream,
    binary: binary.stream,
    end: endAll,
    close: (code, reason) => {
      endAll()
      // Through the same guard as every other close path: a double close, or a
      // close after the peer already went away, throws on some runtimes, and
      // this one runs in a caller's cleanup where that has nowhere to go.
      closeQuietly(socket, code, reason)
    },
  }
}

/** Normalizes whatever a runtime calls "binary" into bytes for the failure record. */
const toBytes = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  // A Blob (a browser-side socket without `binaryType = 'arraybuffer'`) or
  // anything else: report it as empty bytes rather than stringifying it into
  // something that would parse as a message.
  return new Uint8Array(0)
}
