import type { JsonPath } from './types'

/**
 * Decodes a single JSON Pointer segment (RFC 6901): percent-decodes it, then
 * unescapes `~1` → `/` and `~0` → `~`. Invalid percent-escapes are left as-is.
 */
const decodeSegment = (segment: string): string => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // leave invalid percent-escapes as-is
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * Parses a JSON Pointer string (RFC 6901) into a path of keys: strips the leading
 * `/`, splits on `/`, decodes each segment, and coerces canonical array-index
 * tokens to numbers so indices and object keys read back the way a path consumer
 * expects. Only RFC 6901 array indices (`0` or a non-zero-leading run of digits)
 * are coerced; a numeric *object* key with a leading zero such as `"01"` is kept
 * as a string, since coercing it would alias to a different key (`obj["01"]` is
 * not `obj[1]`). A bare `''` or `'/'` is the empty path.
 */
export const pointerToPath = (pointer: string): JsonPath => {
  if (pointer === '' || pointer === '/') return []
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((segment) => {
      const decoded = decodeSegment(segment)
      return /^(0|[1-9]\d*)$/.test(decoded) ? Number(decoded) : decoded
    })
}

/**
 * Walks a JSON Pointer string (RFC 6901) to the value it points to within
 * `root`. A bare `''` or `'/'` returns the root document. Segment escapes are
 * decoded (`~1` → `/`, `~0` → `~`). Returns `undefined` when any segment along
 * the path is missing or traverses a non-object.
 */
export const getByPointer = (root: unknown, pointer: string): unknown => {
  if (pointer === '' || pointer === '/') return root

  const segments = pointer.replace(/^\//, '').split('/').map(decodeSegment)

  let current: unknown = root
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    const key = Array.isArray(current) ? Number(segment) : segment
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
