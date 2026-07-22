import type { StreamingBody } from './types'

/**
 * One Server-Sent Events message. Every field is optional except when you want
 * the client's `EventSource` to fire a named listener (`event`) or resume from
 * a point (`id`). `data` may contain newlines — each line is emitted as its
 * own `data:` field per the spec.
 */
export type SseEvent = {
  readonly data?: string
  readonly event?: string
  readonly id?: string
  /** Reconnection delay hint in milliseconds (`retry:` field). */
  readonly retry?: number
  /** A comment line (`: ...`) — the idiomatic keep-alive ping. */
  readonly comment?: string
}

// The SSE line grammar ends a line on CR, LF, or CRLF, so splitting a
// multi-line field value on this catches every terminator a browser's
// `EventSource` parser would. Splitting on `\n` alone (missing `\r`) is an
// injection hole: a lone CR in `data` is emitted verbatim, and the client
// reads it as a line break, letting attacker-controlled text forge extra
// `data:` fields — or, via `\r\r`, terminate the event and forge a whole new
// one. Applied to `data` and `comment`, which legitimately span lines.
const SSE_NEWLINE = /\r\n|[\r\n]/

// `event` and `id` are single-value control fields — one line by construction.
// A CR or LF in them cannot be a legitimate line break, so it can only be an
// attempt to inject additional fields/events; strip both rather than emit them.
const stripNewlines = (value: string): string => value.replace(/[\r\n]/g, '')

/**
 * Serializes one {@link SseEvent} into an SSE frame (fields followed by the
 * blank-line terminator). Exported for hand-rolled streams and tests.
 *
 * Newlines in field values are handled per the SSE line grammar so a handler
 * that streams user-controlled strings cannot forge fields or events: `data`
 * and `comment` split on CR/LF/CRLF into repeated fields, while the
 * single-line `event`/`id` fields have any CR/LF stripped.
 */
export const formatSse = (event: SseEvent): string => {
  let frame = ''
  if (event.comment !== undefined) {
    for (const line of event.comment.split(SSE_NEWLINE)) frame += `: ${line}\n`
  }
  if (event.event !== undefined) frame += `event: ${stripNewlines(event.event)}\n`
  if (event.id !== undefined) frame += `id: ${stripNewlines(event.id)}\n`
  if (event.retry !== undefined) frame += `retry: ${event.retry}\n`
  if (event.data !== undefined) {
    for (const line of event.data.split(SSE_NEWLINE)) frame += `data: ${line}\n`
  }
  return `${frame}\n`
}

/**
 * Options for {@link sseStream}.
 */
export type SseStreamOptions = {
  /**
   * Aborts the stream — pass `request.signal` so the generator stops when the
   * client disconnects instead of producing events nobody reads.
   */
  readonly signal?: AbortSignal
}

/**
 * Turns an async iterable of events into a `text/event-stream` body — the SSE
 * helper FastAPI, Hono, and Django Channels provide, here producing a
 * {@link StreamingBody} that drops straight into a raw-`contentType` route.
 * Declare the response `contentType: 'text/event-stream'` and return this as
 * the body; the adapter streams it untouched.
 *
 * The source can be an async generator (the natural fit) or any async
 * iterable. When `signal` aborts, iteration stops and the stream closes.
 *
 * @example
 * ```typescript
 * const events = defineRoute({
 *   method: 'get',
 *   path: '/events',
 *   responses: { 200: { contentType: 'text/event-stream' } },
 *   handler: ({ request }) => ({
 *     status: 200,
 *     body: sseStream(
 *       (async function* () {
 *         for (let n = 0; n < 10; n++) yield { data: String(n) }
 *       })(),
 *       { signal: request.signal },
 *     ),
 *   }),
 * })
 * ```
 */
export const sseStream = (source: AsyncIterable<SseEvent | string>, options?: SseStreamOptions): StreamingBody => {
  const encoder = new TextEncoder()
  const signal = options?.signal
  const iterator = source[Symbol.asyncIterator]()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal?.aborted === true) {
          await iterator.return?.()
          controller.close()
          return
        }
        const { done, value } = await iterator.next()
        if (done === true) {
          controller.close()
          return
        }
        const event: SseEvent = typeof value === 'string' ? { data: value } : value
        controller.enqueue(encoder.encode(formatSse(event)))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      // Client hung up — let the generator run its finally blocks.
      await iterator.return?.()
    },
  })
}
