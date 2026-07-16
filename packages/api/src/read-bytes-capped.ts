import { payloadTooLargeError } from './payload-too-large'

/**
 * Reads a body stream into one buffer, enforcing a byte limit while the data
 * arrives. The declared `content-length` is checked first so oversized honest
 * requests fail before any transfer, but the running count is what actually
 * enforces the limit — a client can lie about (or omit) the header, and a
 * chunked upload has no header at all.
 *
 * Exported so `compileToModule` output can import it: both engines must cut
 * off an oversized body at exactly the same byte.
 */
export const readBytesCapped = async (
  stream: ReadableStream<Uint8Array> | null,
  contentLength: string | null | undefined,
  limit: number,
): Promise<Uint8Array> => {
  if (contentLength !== null && contentLength !== undefined) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > limit) throw payloadTooLargeError(limit)
  }
  if (stream === null) return new Uint8Array(0)

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      // Stop pulling from the wire — without the cancel, an attacker's
      // oversized upload would keep streaming into a buffer nobody reads.
      await reader.cancel()
      throw payloadTooLargeError(limit)
    }
    chunks.push(value)
  }

  if (chunks.length === 1) return chunks[0] as Uint8Array
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
