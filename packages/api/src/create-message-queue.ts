/**
 * A push source turned into something `for await` can read.
 *
 * Both transports deliver messages by pushing — `WebSocket` fires events,
 * WebTransport resolves reads — while application code wants to pull. This is
 * the adapter between the two, and it buffers rather than drops: a burst that
 * arrives before the consumer's next turn is still there when it comes back.
 */
export type MessageQueue<T> = {
  /** Hands a value to the consumer, or buffers it until one asks. */
  readonly push: (value: T) => void
  /** Ends the stream. A non-undefined `error` makes the iterator throw it. */
  readonly end: (error?: unknown) => void
  /** The consumer side. Iterating twice shares one queue, it does not tee. */
  readonly stream: AsyncIterableIterator<T>
}

/**
 * Builds a {@link MessageQueue}.
 *
 * Unbounded on purpose. A bound here would have to either drop messages —
 * unacceptable on a reliable channel, which is exactly what both transports
 * promise — or apply backpressure, which for a WebSocket means not reading the
 * socket, something the browser API gives no way to express. Where the volume
 * genuinely needs bounding, the place to do it is the protocol on top (acks,
 * windowing), not a silently lossy queue underneath.
 */
export const createMessageQueue = <T>(): MessageQueue<T> => {
  const buffered: T[] = []
  const waiting: ((result: IteratorResult<T>) => void)[] = []
  let failure: { error: unknown } | undefined
  let ended = false

  const push = (value: T): void => {
    if (ended) return
    const next = waiting.shift()
    if (next === undefined) buffered.push(value)
    else next({ value, done: false })
  }

  const end = (error?: unknown): void => {
    if (ended) return
    ended = true
    if (error !== undefined) failure = { error }
    // Only consumers parked right now are released here. Anything still
    // buffered is drained first by `next` below, so a close that races the
    // last message does not swallow it.
    while (waiting.length > 0) waiting.shift()?.({ value: undefined, done: true })
  }

  const stream: AsyncIterableIterator<T> = {
    next: (): Promise<IteratorResult<T>> => {
      // Length-checked rather than `shift() !== undefined`, so a queue of a
      // type that legitimately includes `undefined` does not read as empty.
      if (buffered.length > 0) return Promise.resolve({ value: buffered.shift() as T, done: false })
      if (ended) {
        // The failure surfaces once the buffer is empty, so a stream that
        // errored after delivering messages still delivers them first.
        if (failure !== undefined) return Promise.reject(failure.error)
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise<IteratorResult<T>>((resolve) => waiting.push(resolve))
    },
    return: (): Promise<IteratorResult<T>> => {
      // `break` out of a `for await` lands here, and it means the consumer is
      // finished — so anything still buffered is dropped rather than drained.
      // That is the opposite of `end()`, where the *producer* stopped and the
      // messages it already delivered still deserve to be read.
      buffered.length = 0
      end()
      return Promise.resolve({ value: undefined, done: true })
    },
    [Symbol.asyncIterator]: (): AsyncIterableIterator<T> => stream,
  }

  return { push, end, stream }
}
