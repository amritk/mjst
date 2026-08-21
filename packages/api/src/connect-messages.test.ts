import { describe, expect, expectTypeOf, it } from 'vitest'

import { connectMessages } from './connect-messages'
import type { WebSocketLike } from './connect-realtime'
import type { MessageChannelOptions, MessageFailure } from './message-channel'
import { defineMessages } from './message-contracts'

const chat = defineMessages({
  clientToServer: {
    say: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  serverToClient: {
    said: {
      type: 'object',
      properties: { from: { type: 'string' }, text: { type: 'string' } },
      required: ['from', 'text'],
    },
  },
})

const fakeWebSocket = () => {
  const sent: unknown[] = []
  let live: Fake | undefined

  class Fake implements WebSocketLike {
    binaryType = 'blob'
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

    constructor() {
      live = this
      queueMicrotask(() => this.emit('open', {}))
    }

    send = (data: unknown) => {
      sent.push(data)
    }
    close = () => this.emit('close', { code: 1000 })
    addEventListener = (type: string, listener: (event: never) => void) => {
      const existing = this.listeners.get(type) ?? []
      existing.push(listener as (event: unknown) => void)
      this.listeners.set(type, existing)
    }
    emit = (type: string, event: unknown) => {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }

  return { Fake, sent, current: () => live }
}

/**
 * Lets the pump drain. `connectMessages` reads `connection.messages` through
 * an async iterator, so a delivered frame crosses several microtask turns
 * before the failure hook sees it — one `Promise.resolve()` is not enough.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Reads one message with its contract type intact. `iterator.next()` resolves
 * to `IteratorResult<T, any>`, so reading `.value` off it directly widens to
 * `any` and silently defeats every type assertion below.
 */
const next = async <T>(iterator: AsyncIterableIterator<T>): Promise<T | undefined> => (await iterator.next()).value

/** Pins the WebSocket arm: WebTransport is not defined in the test runtime. */
const connect = async (socket: ReturnType<typeof fakeWebSocket>, options?: Pick<MessageChannelOptions, 'onInvalid'>) =>
  connectMessages(chat, {
    url: 'wss://api.example.com/ws/lobby',
    transports: ['websocket'],
    webSocket: socket.Fake,
    ...options,
  })

describe('connectMessages', () => {
  it('validates and narrows what the server sends', async () => {
    const socket = fakeWebSocket()
    const channel = await connect(socket)
    socket.current()?.emit('message', { data: JSON.stringify({ type: 'said', from: 'ada', text: 'hi' }) })
    const message = await next(channel.messages)
    expect(message).toEqual({ type: 'said', from: 'ada', text: 'hi' })
    if (message?.type === 'said') expectTypeOf(message.from).toEqualTypeOf<string>()
  })

  it('serializes what the client sends', async () => {
    const socket = fakeWebSocket()
    const channel = await connect(socket)
    channel.send({ type: 'say', text: 'hello' })
    expect(socket.sent).toEqual([JSON.stringify({ type: 'say', text: 'hello' })])
  })

  it('validates the opposite direction from the server — the same contract, inverted', async () => {
    const socket = fakeWebSocket()
    const failures: MessageFailure[] = []
    const channel = await connect(socket, { onInvalid: (failure) => void failures.push(failure) })
    // `say` is clientToServer; a server sending it is off-contract here, and
    // is exactly what `bindMessages` accepts. One declaration, both ends.
    socket.current()?.emit('message', { data: JSON.stringify({ type: 'say', text: 'hi' }) })
    await flush()
    expect(failures[0]?.reason).toBe('unknown-type')
    void channel
  })

  it('surfaces a server message that fails its schema', async () => {
    const socket = fakeWebSocket()
    const failures: MessageFailure[] = []
    // `'ignore'` keeps the connection up for the second frame; the default
    // would have closed it on the first, which the next test covers.
    await connect(socket, {
      onInvalid: (failure) => {
        failures.push(failure)
        return 'ignore'
      },
    })
    socket.current()?.emit('message', { data: JSON.stringify({ type: 'said', from: 'ada', text: 42 }) })
    await flush()
    expect(failures[0]?.reason).toBe('invalid-payload')
    expect(failures[0]?.errors?.[0]?.path).toBe('/text')

    // A *missing* property is reported at the object it is missing from,
    // not at the path it would have had.
    socket.current()?.emit('message', { data: JSON.stringify({ type: 'said', from: 'ada' }) })
    await flush()
    expect(failures[1]?.reason).toBe('invalid-payload')
    expect(failures[1]?.errors?.[0]?.path).toBe('')
  })

  it('closes on an off-contract frame by default', async () => {
    const socket = fakeWebSocket()
    const channel = await connect(socket)
    socket.current()?.emit('message', { data: JSON.stringify({ type: 'said', from: 'ada' }) })
    await flush()
    // A client that cannot trust what it is being sent stops reading it.
    expect(await channel.messages.next()).toEqual({ value: undefined, done: true })
  })

  it('reports the transport', async () => {
    const socket = fakeWebSocket()
    const channel = await connect(socket)
    expect(channel.transport).toBe('websocket')
  })

  it('delivers binary frames on their own iterator, not the drained connection', async () => {
    const socket = fakeWebSocket()
    // The option, not a first read: `pump` starts before this resolves, so a
    // frame can arrive before any caller could have subscribed.
    const channel = await connectMessages(chat, {
      url: 'wss://api.example.com/ws/lobby',
      transports: ['websocket'],
      webSocket: socket.Fake,
      receiveBinary: true,
    })
    socket.current()?.emit('message', { data: new Uint8Array([7, 8]).buffer })
    await flush()
    expect(await next(channel.binary)).toEqual(new Uint8Array([7, 8]))
    // And this is why `binary` exists rather than a pointer at the underlying
    // connection: the channel drains `connection.messages` to feed itself and
    // the queue does not tee, so reading it parks forever. Raced against a
    // tick, because asserting "never resolves" cannot be awaited directly.
    const raced = await Promise.race([
      next(channel.connection.messages).then(() => 'yielded'),
      flush().then(() => 'parked'),
    ])
    expect(raced).toBe('parked')
  })

  it('validates an outbound message without its tag, so a closed schema passes', async () => {
    const closed = defineMessages({
      clientToServer: {
        say: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    })
    const socket = fakeWebSocket()
    const channel = await connectMessages(closed, {
      url: 'wss://api.example.com/ws/lobby',
      transports: ['websocket'],
      webSocket: socket.Fake,
      validateOutbound: true,
    })
    expect(() => channel.send({ type: 'say', text: 'hi' })).not.toThrow()
    expect(socket.sent).toEqual([JSON.stringify({ type: 'say', text: 'hi' })])
    expect(() => channel.send({ type: 'say' } as never)).toThrow(/failed its schema/)
  })

  it('ends iteration when the connection closes', async () => {
    const socket = fakeWebSocket()
    const channel = await connect(socket)
    channel.close()
    expect(await channel.messages.next()).toEqual({ value: undefined, done: true })
  })
})
