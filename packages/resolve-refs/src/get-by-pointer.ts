import type { JsonPath } from './types'

/** Decodes a single JSON-pointer segment: `%XX` first, then the `~1`/`~0` escapes. */
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
 * Parses a JSON Pointer string (RFC 6901) into a path of keys/indices. A bare
 * `''` or `'/'` is the whole document, so it yields an empty path. Segments that
 * look like array indices become numbers; everything else stays a string. This
 * is the path form callers use to locate a node (e.g. for source maps), whereas
 * {@link getByPointer} walks the same segments to fetch the value.
 */
export const pointerToPath = (pointer: string): JsonPath => {
  if (pointer === '' || pointer === '/') return []
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((segment) => {
      const decoded = decodeSegment(segment)
      return /^\d+$/.test(decoded) ? Number(decoded) : decoded
    })
}

/**
 * Walks a JSON Pointer string (RFC 6901) to the value it points to within
 * `root`. A bare `''` or `'/'` returns the root document. Segment escapes are
 * decoded (`%XX`, then `~1` → `/`, `~0` → `~`). Returns `undefined` when any
 * segment along the path is missing or traverses a non-object.
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
