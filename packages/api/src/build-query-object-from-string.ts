import { assignQueryPair, buildQueryObject } from './build-query-object'
import type { Coercion } from './types'

/**
 * Builds the query object straight from the raw query string, skipping
 * `URLSearchParams` construction — which benchmarked as the single largest
 * cost on query-validated routes. The fast path only claims strings with no
 * percent-escapes and no `+`: for those, slicing between `&` and `=` is
 * exactly what URLSearchParams would produce. Anything encoded falls back to
 * URLSearchParams itself, so application/x-www-form-urlencoded semantics
 * (UTF-8 escapes, `+` as space, malformed-escape tolerance) are never
 * reimplemented — the parity test holds the two paths equal by comparison
 * against the real thing.
 */
export const buildQueryObjectFromString = (
  queryString: string,
  coercions: ReadonlyMap<string, Coercion>,
): Record<string, unknown> => {
  // URLSearchParams tolerates one leading '?', so this does too.
  const source = queryString.charCodeAt(0) === 63 ? queryString.slice(1) : queryString
  if (source === '') return Object.create(null) as Record<string, unknown>
  if (source.includes('%') || source.includes('+')) {
    return buildQueryObject(new URLSearchParams(source), coercions)
  }

  // Null prototype for the same reason as buildQueryObject: `__proto__` and
  // friends must land as own properties for the schema to judge.
  const query: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  const length = source.length
  let start = 0
  while (start < length) {
    let end = source.indexOf('&', start)
    if (end === -1) end = length
    // Empty segments ('a=1&&b=2') produce no pair, same as URLSearchParams.
    if (end > start) {
      const eq = source.indexOf('=', start)
      const hasValue = eq !== -1 && eq < end
      // A bare key ('?flag') keeps an empty value, and a bare value ('?=x')
      // keeps an empty key — both match URLSearchParams.
      const key = source.slice(start, hasValue ? eq : end)
      const raw = hasValue ? source.slice(eq + 1, end) : ''
      assignQueryPair(query, key, raw, coercions)
    }
    start = end + 1
  }
  return query
}
