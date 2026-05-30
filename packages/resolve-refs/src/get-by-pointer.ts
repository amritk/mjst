/**
 * Walks a JSON Pointer string (RFC 6901) to the value it points to within
 * `root`. A bare `''` or `'/'` returns the root document. Segment escapes are
 * decoded (`~1` → `/`, `~0` → `~`). Returns `undefined` when any segment along
 * the path is missing or traverses a non-object.
 */
export const getByPointer = (root: unknown, pointer: string): unknown => {
  if (pointer === '' || pointer === '/') return root

  const segments = pointer
    .replace(/^\//, '')
    .split('/')
    .map((segment) => {
      let decoded = segment
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        // leave invalid percent-escapes as-is
      }
      return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
    })

  let current: unknown = root
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    const key = Array.isArray(current) ? Number(segment) : segment
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
