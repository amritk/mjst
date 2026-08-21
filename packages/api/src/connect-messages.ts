import type { ConnectRealtimeOptions, RealtimeConnection, RealtimeTransport } from './connect-realtime'
import { connectRealtime } from './connect-realtime'
import type { MessageChannelOptions } from './message-channel'
import { assertOutbound, createIngest } from './message-channel'
import type { AnyMessagesContract, ClientToServerMessage, ServerToClientMessage } from './message-contracts'
import { prepareMessages } from './message-contracts'

/** Options for {@link connectMessages}: a realtime connection plus the channel policy. */
export type ConnectMessagesOptions = ConnectRealtimeOptions & MessageChannelOptions

/**
 * A contract-typed view of one connection, from the client's side.
 *
 * The mirror image of the server's channel: the directions swap, and nothing
 * else does. That symmetry is the whole return on declaring the contract once
 * — the browser's `send` is exactly the server's `messages`, checked against
 * the same schema, so a mismatch cannot survive a type-check on either side.
 */
export type ClientMessageChannel<M extends AnyMessagesContract> = {
  /** Which transport connected. Useful for metrics, not for logic. */
  readonly transport: RealtimeTransport
  /** Sends one `clientToServer` message. */
  readonly send: (message: ClientToServerMessage<M>) => void
  /** Validated `serverToClient` messages, in order. */
  readonly messages: AsyncIterableIterator<ServerToClientMessage<M>>
  /**
   * Binary frames, which no JSON contract describes. Read them here rather
   * than from `connection.messages`: the channel drains that iterator to feed
   * this one and the underlying queue does not tee, so nothing is left there.
   *
   * Opt in with `receiveBinary`; without it this iterator has already ended.
   * The flag is what makes it raceless — `pump` starts before this function
   * resolves, so frames can arrive before any caller could have subscribed.
   */
  readonly binary: AsyncIterableIterator<Uint8Array>
  /** Closes the connection. Idempotent. */
  readonly close: () => void
  /** Resolves when the connection closes, for whatever reason. */
  readonly closed: Promise<void>
  /**
   * The underlying connection, for `session` and the transport escape hatches.
   *
   * Its `messages` iterator is **drained by this channel** and will not yield
   * — read {@link ClientMessageChannel.messages} or
   * {@link ClientMessageChannel.binary} instead.
   */
  readonly connection: RealtimeConnection
}

/**
 * Connects a realtime channel and applies a messages contract to it.
 *
 * Everything `connectRealtime` does — WebTransport first, WebSocket fallback
 * behind a deadline — with the frames parsed, validated against the contract's
 * `serverToClient` half, and narrowed to a tagged union:
 *
 * ```typescript
 * const channel = await connectMessages(chatMessages, { url: 'https://api.example.com/ws/lobby' })
 * channel.send({ type: 'say', text: 'hello' })
 * for await (const message of channel.messages) {
 *   if (message.type === 'said') render(message.from, message.text)
 * }
 * ```
 *
 * A client validating what the *server* sent is not paranoia about the server.
 * It is how a deploy skew becomes one legible failure at the seam instead of
 * `undefined is not an object` three components deep, and it is the same
 * argument for validating a fetch response body — with more force here, because
 * a socket stays open across a deploy that changes what the other end sends.
 *
 * Binary frames never become contract messages — nothing in a JSON contract
 * describes them — so they arrive on `channel.binary`. Not on
 * `connection.messages`: this channel drains that iterator to feed its own and
 * the queue underneath does not tee, so anything left there is unreachable.
 * `connection` remains exposed for `session` and the transport escape hatches.
 */
export const connectMessages = async <const M extends AnyMessagesContract>(
  contract: M,
  options: ConnectMessagesOptions,
): Promise<ClientMessageChannel<M>> => {
  const { discriminator, clientToServer, serverToClient } = prepareMessages(contract)
  const connection = await connectRealtime(options)

  const { accept, queue, binary } = createIngest<ServerToClientMessage<M>>(
    serverToClient,
    discriminator,
    options,
    // The client closes its own end; there is no code/reason to hand a peer,
    // and `RealtimeConnection.close` takes none.
    () => {
      endAll()
      connection.close()
    },
  )

  const endAll = (error?: unknown): void => {
    queue.end(error)
    binary.end(error)
  }

  // `connectRealtime` already delivers a queue, so this drains it rather than
  // attaching a listener — the transports differ underneath and it has already
  // reconciled them.
  const pump = async (): Promise<void> => {
    try {
      for await (const raw of connection.messages) accept(raw)
      endAll()
    } catch (error) {
      endAll(error)
    }
  }
  void pump()
  void connection.closed.then(() => endAll())

  const send = (message: ClientToServerMessage<M>): void => {
    if (options.validateOutbound === true)
      assertOutbound(message, clientToServer, discriminator, 'connectMessages', 'clientToServer')
    connection.send(JSON.stringify(message))
  }

  return {
    transport: connection.transport,
    send,
    messages: queue.stream,
    binary: binary.stream,
    close: () => {
      endAll()
      connection.close()
    },
    closed: connection.closed,
    connection,
  }
}
