import type { JsonPath } from './types'

/**
 * Decodes a single JSON Pointer segment (RFC 6901): percent-decodes it, then
 * unescapes `~1` → `/` and `~0` → `~`. Invalid percent-escapes are left as-is.
 */
const decodeSegment = (segment: string): string => {
  // Nearly every segment is a bare name, with nothing to percent-decode or
  // unescape, and this runs for every segment of every pointer resolved.
  if (!segment.includes('%') && !segment.includes('~')) return segment
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
      return ARRAY_INDEX.test(decoded) ? Number(decoded) : decoded
    })
}

/** An RFC 6901 array index: `0`, or a run of digits with no leading zero. */
const ARRAY_INDEX = /^(0|[1-9]\d*)$/

/**
 * Whether a reference fragment is a JSON Pointer rather than a plain-name
 * anchor. RFC 6901 pointers are empty or start with `/`; anything else names an
 * `$anchor`.
 */
export const isPointerFragment = (fragment: string): boolean => fragment === '' || fragment.startsWith('/')

/**
 * Walks a JSON Pointer string (RFC 6901) to the value it points to within
 * `root`. A bare `''` or `'/'` returns the root document. Segment escapes are
 * decoded (`~1` → `/`, `~0` → `~`). Returns `undefined` when any segment along
 * the path is missing or traverses a non-object.
 *
 * Only *own* properties are addressable. A plain `[key]` read let `#/constructor`
 * resolve to `Object`'s constructor and inline a JS function into the
 * "dereferenced" document — and, on a process where anything had polluted
 * `Object.prototype`, let an arbitrary `#/<name>` resolve to the injected value
 * instead of being reported as unresolvable.
 */
export const getByPointer = (root: unknown, pointer: string): unknown => {
  if (pointer === '' || pointer === '/') return root

  const segments = pointer.replace(/^\//, '').split('/').map(decodeSegment)

  let current: unknown = root
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    // `Number()` alone read `0x1`, `1e0`, ` 1`, `01` and `''` as indices too, so
    // a pointer RFC 6901 calls unresolvable landed on some element instead.
    if (Array.isArray(current) && !ARRAY_INDEX.test(segment)) return undefined
    const key = Array.isArray(current) ? Number(segment) : segment
    if (!Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
