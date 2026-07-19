import { payloadTooLargeError } from './payload-too-large'
import { readBytesCapped } from './read-bytes-capped'

/**
 * The slice of a fetch `Request` the capped read needs. Structural so tests
 * and compiled modules can pass anything request-shaped.
 */
type BodySource = {
  readonly headers: { get(name: string): string | null }
  readonly body: ReadableStream<Uint8Array> | null
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Reads a request body under a byte limit without giving up the runtime's
 * native buffered read. A body whose declared `content-length` fits the limit
 * takes `arrayBuffer()` — the JS streaming loop in {@link readBytesCapped}
 * costs an order of magnitude more per request, and every mainstream client
 * declares the header. The byte count is re-checked after the read, so a
 * header that understates the body still answers 413 (runtimes already
 * enforce `content-length` framing, making that path theoretical). Chunked
 * requests — no header, or an unparseable one — fall back to the streaming
 * reader, where mid-flight enforcement is the only option.
 *
 * Exported so `compileToModule` output can import it: both engines must pick
 * the same read strategy at the same byte.
 */
export const readBodyCapped = async (request: BodySource, limit: number): Promise<Uint8Array> => {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared)) {
      if (declared > limit) throw payloadTooLargeError(limit)
      const buffer = await request.arrayBuffer()
      if (buffer.byteLength > limit) throw payloadTooLargeError(limit)
      return new Uint8Array(buffer)
    }
  }
  return readBytesCapped(request.body, contentLength, limit)
}
