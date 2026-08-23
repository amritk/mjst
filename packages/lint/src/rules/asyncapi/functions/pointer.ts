/**
 * Decodes one JSON Pointer segment taken from a `$ref`: percent-escapes first
 * (the fragment is carried in a URI, and RFC 6901 §6 requires the encoding),
 * then `~1`/`~0`.
 *
 * The `$ref` is document text, so a malformed escape like `%zz` is something an
 * author can write, and `decodeURIComponent` throws `URIError` on it — which
 * replaced a real finding with an internal-error diagnostic on the wrong node.
 * An undecodable segment is compared as written instead.
 */
export const pointerSegment = (segment: string): string => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // Not valid percent-encoding — compare the segment literally.
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}
