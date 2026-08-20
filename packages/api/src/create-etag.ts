import { fnv1aHexBytes } from './fnv1a-hex'
import { matchesIfNoneMatch } from './matches-if-none-match'
import type { FetchOnResponse } from './to-fetch-handler'

/**
 * Options for {@link createETag}.
 */
export type ETagOptions = {
  /**
   * Largest body (in bytes) to buffer and hash. Bodies over this pass through
   * untouched — hashing a huge payload to save one round trip is a bad trade.
   * Defaults to 1 MiB.
   */
  readonly maxBytes?: number
  /**
   * Compute the hash. Defaults to FNV-1a (no crypto dependency, Workers-safe).
   * Swap in a stronger digest if collisions across your payloads matter more
   * than the extra cost.
   */
  readonly hash?: (body: Uint8Array) => string
}

const SAFE = new Set(['GET', 'HEAD'])

/**
 * Automatic entity tags and conditional-GET handling — the ETag/`If-None-Match`
 * dance Rails, Fastify (`@fastify/etag`), and Hono all offer. On a safe-method
 * `200` with a buffered body, the decorator hashes the bytes, sets a strong
 * `ETag`, and — when the request's `If-None-Match` already matches — replaces
 * the reply with a bodyless `304`, saving the client the download.
 *
 * It buffers the response body to hash it, so it is opt-in per app rather than
 * always-on: skip it on routes that stream (it never touches a
 * `text/event-stream` reply), and cap it with `maxBytes` on large payloads.
 * A response that already carries an `ETag` — a handler that knows its own
 * version — keeps it and is never buffered, but still gets the conditional
 * half: a matching `If-None-Match` answers `304` against the handler's own
 * validator.
 *
 * @example
 * ```typescript
 * const handler = toFetchHandler(api, { onResponse: [createETag()] })
 * ```
 */
export const createETag = (options?: ETagOptions): FetchOnResponse => {
  const maxBytes = options?.maxBytes ?? 1_048_576
  const hash = options?.hash ?? fnv1aHexBytes

  return async (response, request) => {
    if (response.status !== 200 || !SAFE.has(request.method)) return undefined
    // A handler that knows its own version already set the validator, so there
    // is nothing to compute — but the conditional half of the exchange is
    // still owed. Answering the 304 here is what makes a hand-set etag worth
    // setting; leaving it to "the response already has one" meant the client
    // downloaded the body it had just proved it already held.
    const declaredEtag = response.headers.get('etag')
    if (declaredEtag !== null) {
      const conditional = request.headers.get('if-none-match')
      if (conditional === null || !matchesIfNoneMatch(conditional, declaredEtag)) return undefined
      if (response.body !== null) void response.body.cancel().catch(() => undefined)
      const unchanged = new Headers(response.headers)
      unchanged.delete('content-length')
      return new Response(null, { status: 304, headers: unchanged })
    }
    // A streamed reply has no bytes to hash without draining it, which would
    // defeat streaming — and hashing an SSE feed is meaningless anyway.
    if (response.headers.get('content-type')?.includes('text/event-stream')) return undefined
    if (response.body === null) return undefined

    // A free early-out when the producer declared a size. It rarely fires on
    // adapter-built replies (`new Response('abc').headers.get('content-length')`
    // is `null`), which is why the read below has to enforce the cap itself.
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > maxBytes) return undefined

    // Read against the cap rather than buffering first and checking after:
    // `arrayBuffer()` on an 8 MB stream would hold all 8 MB in memory to then
    // decide the 1 MiB limit was exceeded, which turns an opt-in optimization
    // into a memory-DoS. The moment the running count passes `maxBytes` the
    // response is handed back with the chunks already read replayed in front
    // of the untouched remainder — nothing more is buffered, and the body
    // keeps streaming to the client.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
      if (total > maxBytes) {
        return new Response(resume(chunks, reader), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
    }

    const bytes = concat(chunks, total)
    const etag = `"${hash(bytes)}"`
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch !== null && matchesIfNoneMatch(ifNoneMatch, etag)) {
      // 304 keeps the validators and cache directives, drops the body and its
      // content-length (a 304 must not carry one).
      const headers = new Headers(response.headers)
      headers.set('etag', etag)
      headers.delete('content-length')
      return new Response(null, { status: 304, headers })
    }

    const headers = new Headers(response.headers)
    headers.set('etag', etag)
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers })
  }
}

/**
 * A stream that replays the chunks already pulled off `reader`, then keeps
 * pulling from it. This is what makes the over-cap bail-out free: the bytes
 * read while counting are not lost and not re-buffered, they are simply handed
 * on, and the rest of the body is never held in memory at all.
 */
const resume = (chunks: readonly Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(chunk)
    },
    pull: async (controller) => {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(value)
    },
    // A client that hangs up must cancel the source too, or the producer keeps
    // generating bytes nobody will ever read.
    cancel: (reason) => reader.cancel(reason),
  })

/** Flattens the counted chunks into the single buffer the hash function takes. */
const concat = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  if (chunks.length === 1 && chunks[0] !== undefined) return chunks[0]
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
