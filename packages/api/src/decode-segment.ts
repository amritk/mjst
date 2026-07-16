/**
 * Percent-decodes a captured path parameter. Literal segments are compared raw
 * (a route pattern should not contain characters that need encoding), but a
 * captured value like `/users/ada%40example.com` should reach the handler
 * decoded. Malformed sequences fall back to the raw text rather than turning
 * the whole request into a 500.
 *
 * Exported so `compileToModule` output can import it — the compiled and
 * runtime engines must decode identically, and sharing the function is what
 * guarantees that.
 */
export const decodeSegment = (segment: string): string => {
  if (!segment.includes('%')) return segment
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
