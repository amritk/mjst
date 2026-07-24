/**
 * FNV-1a 32-bit hash of a string, formatted as 8 lowercase hex digits.
 *
 * This exists to derive the OpenAPI document's etag without pulling in a
 * crypto dependency (Workers-friendly, works at build time in
 * `compileToModule` and at startup in `createApi` — both engines must produce
 * identical etags for identical documents, so both call exactly this).
 *
 * The hash runs over UTF-16 code units rather than UTF-8 bytes. That deviates
 * from the canonical byte-oriented FNV-1a for non-ASCII input, but it stays
 * fully deterministic — which is all an etag needs — and skips an encoding
 * pass over what can be a large document string.
 */
export const fnv1aHex = (input: string): string => {
  // FNV-1a offset basis and prime for the 32-bit variant.
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    // Math.imul keeps the multiplication in 32-bit integer land — a plain `*`
    // would spill into floats and corrupt the low bits.
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * FNV-1a 32-bit hash of raw bytes, formatted as 8 lowercase hex digits.
 *
 * Use this when hashing a binary payload (e.g. an ETag over a response body):
 * decoding bytes to a string first is lossy — `TextDecoder` maps every invalid
 * UTF-8 byte to U+FFFD, so distinct byte sequences would collide. Hashing the
 * bytes directly avoids that. For ASCII input this matches {@link fnv1aHex}.
 */
export const fnv1aHexBytes = (bytes: Uint8Array): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < bytes.length; index++) {
    hash ^= bytes[index] as number
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
