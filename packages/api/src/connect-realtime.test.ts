import { describe, expect, it } from 'vitest'

import type { RealtimeTransport, WebSocketLike, WebTransportLike } from './connect-realtime'
import { connectRealtime } from './connect-realtime'
import { decodeRealtimeFrames, encodeRealtimeFrame, type RealtimeMessage } from './realtime-framing'

/**
 * A WebTransport whose bidirectional stream is a real `TransformStream` pair,
 * so the framing is exercised against genuine web streams rather than a stub.
 * `behaviour` picks which way a connection attempt goes.
 */
const fakeWebTransport = (behaviour: 'open' | 'reject' | 'hang') => {
  const toServer = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  const urls: string[] = []

  class Fake implements WebTransportLike {
    readonly ready: Promise<void>
    readonly closed: Promise<unknown>
    closeCalls = 0

    constructor(url: string) {
      urls.push(url)
      this.ready =
        behaviour === 'open'
          ? Promise.resolve()
          : behaviour === 'reject'
            ? Promise.reject(new Error('QUIC handshake failed'))
            : new Promise<void>(() => undefined)
      // Swallow the rejection so an unhandled one does not fail the run; the
      // code under test attaches its own handler.
      this.ready.catch(() => undefined)
      this.closed = new Promise(() => undefined)
    }

    createBidirectionalStream = () => Promise.resolve({ readable: toClient.readable, writable: toServer.writable })
    close = () => {
      this.closeCalls += 1
    }
  }

  return {
    Fake,
    urls,
    /** Sends a framed message from the "server" to the client. */
    serverSend: async (message: RealtimeMessage) => {
      const writer = toClient.writable.getWriter()
      await writer.write(encodeRealtimeFrame(message))
      writer.releaseLock()
    },
    /** Everything the client has written so far, decoded. */
    serverReceived: async (count: number): Promise<RealtimeMessage[]> => {
      const reader = toServer.readable.getReader()
      const decode = decodeRealtimeFrames()
      const seen: RealtimeMessage[] = []
      while (seen.length < count) {
        const { done, value } = await reader.read()
        if (done === true) break
        seen.push(...decode(value))
      }
      reader.releaseLock()
      return seen
    },
  }
}

/** A WebSocket that can open, refuse, or hang. */
const fakeWebSocket = (behaviour: 'open' | 'refuse' | 'hang') => {
  const urls: string[] = []
  const sent: unknown[] = []
  let live: Fake | undefined

  class Fake implements WebSocketLike {
    binaryType = 'blob'
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

    constructor(url: string) {
      urls.push(url)
      live = this
      if (behaviour === 'hang') return
      queueMicrotask(() => {
        if (behaviour === 'open') this.emit('open', {})
        else this.emit('error', { code: 1006 })
      })
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

  return { Fake, urls, sent, current: () => live }
}

const nextMessage = async (messages: AsyncIterableIterator<RealtimeMessage>): Promise<RealtimeMessage | undefined> =>
  (await messages.next()).value

describe('connect-realtime', () => {
  it('prefers WebTransport when it connects', async () => {
    const transport = fakeWebTransport('open')
    const socket = fakeWebSocket('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws/lobby',
      webTransport: transport.Fake,
      webSocket: socket.Fake,
    })
    expect(connection.transport).toBe('webtransport')
    expect(socket.urls).toEqual([])
  })

  it('drops down to WebSocket when WebTransport is missing from the runtime', async () => {
    // The ordinary case, not an error case: Node, Bun, and any browser without
    // the API land here.
    const socket = fakeWebSocket('open')
    const fallbacks: RealtimeTransport[] = []
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws/lobby',
      webSocket: socket.Fake,
      onFallback: (which) => fallbacks.push(which),
    })
    expect(connection.transport).toBe('websocket')
    expect(fallbacks).toEqual(['webtransport'])
  })

  it('drops down when the WebTransport handshake is refused', async () => {
    const transport = fakeWebTransport('reject')
    const socket = fakeWebSocket('open')
    const reasons: unknown[] = []
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws/lobby',
      webTransport: transport.Fake,
      webSocket: socket.Fake,
      onFallback: (_, reason) => reasons.push(reason),
    })
    expect(connection.transport).toBe('websocket')
    expect((reasons[0] as Error).message).toMatch(/QUIC handshake failed/)
  })

  it('drops down when WebTransport hangs, which is how a UDP-blocked network fails', async () => {
    // The case the deadline exists for: QUIC cannot distinguish a blackhole
    // from a slow path, so without a timeout this never falls back at all.
    const transport = fakeWebTransport('hang')
    const socket = fakeWebSocket('open')
    const started = Date.now()
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws/lobby',
      webTransport: transport.Fake,
      webSocket: socket.Fake,
      connectTimeoutMs: 40,
    })
    expect(connection.transport).toBe('websocket')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('addresses the same endpoint on both transports, deriving each scheme', async () => {
    const transport = fakeWebTransport('reject')
    const socket = fakeWebSocket('open')
    await connectRealtime({
      url: 'wss://api.example.com/ws/lobby',
      webTransport: transport.Fake,
      webSocket: socket.Fake,
    })
    expect(transport.urls).toEqual(['https://api.example.com/ws/lobby'])
    expect(socket.urls).toEqual(['wss://api.example.com/ws/lobby'])
  })

  it('leaves a plaintext development URL alone rather than forcing TLS', async () => {
    const socket = fakeWebSocket('open')
    await connectRealtime({ url: 'ws://localhost:3000/ws', webSocket: socket.Fake })
    expect(socket.urls).toEqual(['ws://localhost:3000/ws'])
  })

  it('pins a single transport when the caller asks for one', async () => {
    const transport = fakeWebTransport('open')
    const socket = fakeWebSocket('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws',
      transports: ['websocket'],
      webTransport: transport.Fake,
      webSocket: socket.Fake,
    })
    expect(connection.transport).toBe('websocket')
    expect(transport.urls).toEqual([])
  })

  it('throws when every transport fails, naming what was tried', async () => {
    const transport = fakeWebTransport('reject')
    const socket = fakeWebSocket('refuse')
    await expect(
      connectRealtime({
        url: 'https://api.example.com/ws',
        webTransport: transport.Fake,
        webSocket: socket.Fake,
      }),
    ).rejects.toThrow(/no transport connected \(tried webtransport, websocket\)/)
  })

  it('round-trips messages over WebTransport through the real stream framing', async () => {
    const transport = fakeWebTransport('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws',
      transports: ['webtransport'],
      webTransport: transport.Fake,
    })

    connection.send('hello')
    connection.send(new Uint8Array([1, 2, 3]))
    expect(await transport.serverReceived(2)).toEqual(['hello', new Uint8Array([1, 2, 3])])

    await transport.serverSend('from server')
    expect(await nextMessage(connection.messages)).toBe('from server')
  })

  it('delivers WebSocket messages with the same types as the WebTransport arm', async () => {
    // The interchangeability promise: binary arrives as a Uint8Array on both,
    // which is why the socket's binaryType is forced to arraybuffer.
    const socket = fakeWebSocket('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws',
      transports: ['websocket'],
      webSocket: socket.Fake,
    })
    expect(socket.current()?.binaryType).toBe('arraybuffer')

    socket.current()?.emit('message', { data: 'text' })
    socket.current()?.emit('message', { data: new Uint8Array([7, 8]).buffer })
    expect(await nextMessage(connection.messages)).toBe('text')
    expect(await nextMessage(connection.messages)).toEqual(new Uint8Array([7, 8]))
  })

  it('sends text as text over WebSocket, so a peer’s typeof check still works', async () => {
    const socket = fakeWebSocket('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws',
      transports: ['websocket'],
      webSocket: socket.Fake,
    })
    connection.send('plain')
    expect(socket.sent).toEqual(['plain'])
  })

  it('ends the message stream and resolves closed when the socket closes', async () => {
    const socket = fakeWebSocket('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws',
      transports: ['websocket'],
      webSocket: socket.Fake,
    })
    connection.close()
    await connection.closed
    expect(await connection.messages.next()).toEqual({ value: undefined, done: true })
  })

  it('buffers messages that arrive before the consumer asks for them', async () => {
    const socket = fakeWebSocket('open')
    const connection = await connectRealtime({
      url: 'https://api.example.com/ws',
      transports: ['websocket'],
      webSocket: socket.Fake,
    })
    socket.current()?.emit('message', { data: 'first' })
    socket.current()?.emit('message', { data: 'second' })
    expect(await nextMessage(connection.messages)).toBe('first')
    expect(await nextMessage(connection.messages)).toBe('second')
  })

  it('stops trying once the caller aborts', async () => {
    const socket = fakeWebSocket('open')
    await expect(
      connectRealtime({
        url: 'https://api.example.com/ws',
        webSocket: socket.Fake,
        signal: AbortSignal.abort(new Error('caller gave up')),
      }),
    ).rejects.toThrow(/caller gave up/)
  })
})
