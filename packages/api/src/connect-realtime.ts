import { createMessageQueue } from './create-message-queue'
import type { RealtimeMessage } from './realtime-framing'
import { DEFAULT_MAX_MESSAGE_BYTES, decodeRealtimeFrames, encodeRealtimeFrame } from './realtime-framing'

/** Which wire a {@link RealtimeConnection} ended up on. */
export type RealtimeTransport = 'webtransport' | 'websocket'

/**
 * The minimum `WebTransport` surface this needs, typed structurally so the
 * package depends on no DOM lib version and stays injectable in tests.
 */
export type WebTransportLike = {
  readonly ready: Promise<void>
  readonly closed: Promise<unknown>
  createBidirectionalStream: () => Promise<{
    readonly readable: ReadableStream<Uint8Array>
    readonly writable: WritableStream<Uint8Array>
  }>
  close: (info?: { closeCode?: number; reason?: string }) => void
}

/** The `WebSocket` surface this needs. */
export type WebSocketLike = {
  binaryType: string
  send: (data: string | ArrayBufferLike | ArrayBufferView) => void
  close: (code?: number, reason?: string) => void
  addEventListener: (type: string, listener: (event: never) => void) => void
}

/**
 * A connected realtime channel, identical in shape whichever transport won.
 *
 * That sameness is the point. A fallback the caller has to branch on is not a
 * fallback — it is two code paths, one of which only runs on the networks the
 * developer does not have.
 */
export type RealtimeConnection = {
  /** Which transport actually connected. Useful for metrics, not for logic. */
  readonly transport: RealtimeTransport
  /** Sends one message. Text stays text and bytes stay bytes on both wires. */
  readonly send: (message: RealtimeMessage) => void
  /** Closes the connection. Idempotent. */
  readonly close: () => void
  /** Resolves when the connection closes, for whatever reason. */
  readonly closed: Promise<void>
  /** Incoming messages, in order. */
  readonly messages: AsyncIterableIterator<RealtimeMessage>
  /**
   * The live `WebTransport` or `WebSocket`. The escape hatch for anything the
   * common shape cannot express — datagrams and extra streams on
   * WebTransport, `bufferedAmount` on a WebSocket. Narrow it with `transport`.
   */
  readonly session: unknown
}

/**
 * Options for {@link connectRealtime}.
 */
export type ConnectRealtimeOptions = {
  /**
   * The endpoint, given once. An `https:` or `wss:` URL both work — the scheme
   * each transport needs is derived from the other, so the two attempts always
   * address the same place.
   */
  readonly url: string
  /**
   * Which transports to try, in order. Defaults to WebTransport first, then
   * WebSocket. Pass a single entry to pin one — `['websocket']` is the way to
   * turn the fallback into the only path.
   */
  readonly transports?: readonly RealtimeTransport[]
  /**
   * How long one transport may take to connect before the next is tried, in
   * milliseconds. Defaults to 3000.
   *
   * This bound is what makes the fallback work on the networks that need it.
   * A WebTransport attempt where UDP is silently dropped — corporate egress
   * filters, some mobile carriers, a fair number of hotel networks — does not
   * fail. It hangs, because QUIC cannot tell a blackhole from a slow path, and
   * without a deadline the "fallback" never runs and the user simply waits.
   */
  readonly connectTimeoutMs?: number
  /** Largest single message accepted, in bytes. See the framing module. */
  readonly maxMessageBytes?: number
  /** Subprotocols for the WebSocket attempt. Ignored by WebTransport. */
  readonly protocols?: string | readonly string[]
  /** Abandons the connection attempt, and closes the connection once open. */
  readonly signal?: AbortSignal
  /** Overrides the `WebTransport` constructor. Defaults to the global. */
  readonly webTransport?: new (
    url: string,
  ) => WebTransportLike
  /** Overrides the `WebSocket` constructor. Defaults to the global. */
  readonly webSocket?: new (
    url: string,
    protocols?: string | readonly string[],
  ) => WebSocketLike
  /**
   * Called when a transport is skipped or fails and the next is tried. The
   * hook exists because a silent fallback hides exactly the signal you want:
   * "WebTransport worked in testing and fails for 40% of production" is
   * invisible until someone reports it.
   */
  readonly onFallback?: (transport: RealtimeTransport, reason: unknown) => void
}

/**
 * Connects a realtime channel, preferring WebTransport and dropping down to
 * WebSocket when it is unavailable, refused, or hung.
 *
 * ```typescript
 * const connection = await connectRealtime({ url: 'https://api.example.com/ws/lobby' })
 * connection.send('hello')
 * for await (const message of connection.messages) render(message)
 * ```
 *
 * WebTransport is tried first because it is the better channel where it works
 * — no head-of-line blocking across streams, and datagrams available through
 * `session`. It is tried *behind a deadline* because where it does not work it
 * usually fails by hanging rather than by erroring.
 *
 * A note on what this does and does not imply about the server. Nothing in
 * this package can serve WebTransport: it needs a QUIC stack, and no runtime
 * the adapters target exposes one through a fetch handler — workerd has no
 * HTTP/3 implementation at all, Bun 1.4 serves HTTP/3 but offers no
 * WebTransport API, and Deno's `upgradeWebTransport` lives on a raw QUIC
 * listener rather than on `Deno.serve`. Adding one would mean a native addon
 * dependency, which would cost this package the Workers and React Native
 * support that being dependency-light buys it. So today the WebTransport arm
 * connects to a separate quic-go, wtransport, or `@fails-components` process
 * speaking the framing in `realtime-framing`, and the WebSocket arm is what
 * `upgradeWebSocket` serves. The negotiation is written now so that the day a
 * runtime does ship server WebTransport, clients already prefer it and no
 * application code changes.
 */
export const connectRealtime = async (options: ConnectRealtimeOptions): Promise<RealtimeConnection> => {
  const order = options.transports ?? (['webtransport', 'websocket'] as const)
  const timeoutMs = options.connectTimeoutMs ?? 3000

  let lastReason: unknown
  for (const transport of order) {
    if (options.signal?.aborted === true) throw options.signal.reason
    try {
      return transport === 'webtransport'
        ? await connectWebTransport(options, timeoutMs)
        : await connectWebSocket(options, timeoutMs)
    } catch (error) {
      lastReason = error
      options.onFallback?.(transport, error)
    }
  }

  throw new Error(`connectRealtime: no transport connected (tried ${order.join(', ')})`, { cause: lastReason })
}

/** Swaps a URL's scheme, so one endpoint addresses both transports. */
const withScheme = (url: string, scheme: 'https' | 'wss'): string => {
  const separator = url.indexOf('://')
  if (separator === -1) return url
  const current = url.slice(0, separator)
  // Only the two transport-equivalent pairs are rewritten. An `http:`/`ws:`
  // development URL is left alone, since silently upgrading it to TLS would
  // fail in a way that looks like the server is down.
  if (current === 'https' || current === 'wss') return `${scheme}://${url.slice(separator + 3)}`
  return url
}

/**
 * Races a connection attempt against the deadline and the caller's signal.
 *
 * The timer is always cleared: a pending `setTimeout` keeps Node's event loop
 * alive, which turns a passing test suite into one that hangs on exit.
 */
const withDeadline = async <T>(
  attempt: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not connect within ${timeoutMs}ms`)), timeoutMs)
  })
  const aborted = new Promise<never>((_, reject) => {
    if (signal === undefined) return
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  try {
    return await Promise.race([attempt, deadline, aborted])
  } finally {
    clearTimeout(timer)
  }
}

const connectWebTransport = async (options: ConnectRealtimeOptions, timeoutMs: number): Promise<RealtimeConnection> => {
  const Transport =
    options.webTransport ??
    (globalThis as unknown as { WebTransport?: new (url: string) => WebTransportLike }).WebTransport
  // Node, Bun, older Safari, and any browser with the flag off land here. It
  // is the ordinary case, not an error case.
  if (Transport === undefined) throw new Error('WebTransport is not available in this runtime')

  const session = new Transport(withScheme(options.url, 'https'))
  // Claimed immediately, not only in the return object below. `closed` rejects
  // when the session dies, and on the throw path below that object is never
  // built — leaving a rejected promise nobody handles, which is an
  // unhandled-rejection crash in Node and a console error in a browser. This
  // is the *default first* transport and the deadline exists precisely for
  // QUIC that hangs, so that path is the common one, not an edge case.
  void session.closed.catch(() => undefined)

  let stream: Awaited<ReturnType<WebTransportLike['createBidirectionalStream']>>
  try {
    stream = await withDeadline(
      session.ready.then(() => session.createBidirectionalStream()),
      timeoutMs,
      'WebTransport',
      options.signal,
    )
  } catch (error) {
    // The deadline or the caller's signal won the race, so nothing here owns
    // the session any more — but it is still connecting, and left alone it may
    // open and stay open, unread, for as long as the peer keeps it. One leaked
    // session per fallback attempt.
    try {
      session.close()
    } catch {
      // Already gone; the throw below is the outcome that matters.
    }
    throw error
  }

  const queue = createMessageQueue<RealtimeMessage>()
  const writer = stream.writable.getWriter()
  const decode = decodeRealtimeFrames(options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES)

  const pump = async (): Promise<void> => {
    const reader = stream.readable.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done === true) break
        for (const message of decode(value)) queue.push(message)
      }
      queue.end()
    } catch (error) {
      queue.end(error)
    }
  }
  void pump()

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    queue.end()
    try {
      session.close()
    } catch {
      // Already gone — closing twice is not an error worth surfacing.
    }
  }
  options.signal?.addEventListener('abort', close, { once: true })

  return {
    transport: 'webtransport',
    // Writes are fire-and-forget to match `WebSocket.send`, which does not
    // return a promise either. A rejected write means the session is gone, and
    // that is reported through `closed`.
    send: (message) => void writer.write(encodeRealtimeFrame(message)).catch(() => undefined),
    close,
    closed: session.closed.then(
      () => {
        queue.end()
      },
      () => {
        queue.end()
      },
    ),
    messages: queue.stream,
    session,
  }
}

const connectWebSocket = async (options: ConnectRealtimeOptions, timeoutMs: number): Promise<RealtimeConnection> => {
  const Socket =
    options.webSocket ??
    (
      globalThis as unknown as {
        WebSocket?: new (url: string, protocols?: string | readonly string[]) => WebSocketLike
      }
    ).WebSocket
  if (Socket === undefined) throw new Error('WebSocket is not available in this runtime')

  const socket = new Socket(withScheme(options.url, 'wss'), options.protocols)
  // Without this a browser delivers binary frames as `Blob`, which would make
  // the message type differ from the WebTransport arm and break the promise
  // that the two are interchangeable.
  socket.binaryType = 'arraybuffer'

  const queue = createMessageQueue<RealtimeMessage>()
  let resolveClosed: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  try {
    await withDeadline(
      new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', (() => resolve()) as never)
        // A refused handshake fires `error` and then `close`; either is enough
        // to move on to the next transport.
        socket.addEventListener('error', ((event: unknown) => reject(errorFrom(event))) as never)
        socket.addEventListener('close', ((event: unknown) => reject(errorFrom(event))) as never)
      }),
      timeoutMs,
      'WebSocket',
      options.signal,
    )
  } catch (error) {
    // Same leak as the WebTransport arm: when the deadline or the signal wins,
    // the abort listener that would have closed this is registered further
    // down and never runs. Closing a CONNECTING socket aborts the handshake,
    // and closing an already-closed one is a no-op, so this is safe on every
    // path that lands here — including the refused handshake.
    try {
      socket.close()
    } catch {
      // Already closing or gone.
    }
    throw error
  }

  socket.addEventListener('message', ((event: { data: unknown }) => {
    const data = event.data
    if (typeof data === 'string') queue.push(data)
    else if (data instanceof ArrayBuffer) queue.push(new Uint8Array(data))
    else if (ArrayBuffer.isView(data)) queue.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }) as never)
  socket.addEventListener('close', (() => {
    queue.end()
    resolveClosed()
  }) as never)

  let done = false
  const close = (): void => {
    if (done) return
    done = true
    try {
      socket.close()
    } catch {
      // Already closing; nothing to report.
    }
  }
  options.signal?.addEventListener('abort', close, { once: true })

  return {
    transport: 'websocket',
    send: (message) => socket.send(typeof message === 'string' ? message : (message as Uint8Array<ArrayBuffer>)),
    close,
    closed,
    messages: queue.stream,
    session: socket,
  }
}

/**
 * Turns a `WebSocket` failure event into an `Error`.
 *
 * Browsers deliberately keep the reason vague — a detailed handshake failure
 * would be a cross-origin information leak — so there is often nothing here
 * beyond "it did not connect". Preserving the event as `cause` at least keeps
 * the close code reachable when there is one.
 */
const errorFrom = (event: unknown): Error => {
  const code = (event as { code?: number } | undefined)?.code
  return new Error(code === undefined ? 'WebSocket failed to connect' : `WebSocket closed with code ${code}`, {
    cause: event,
  })
}
