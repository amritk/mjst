/** A memoization map with a hard entry cap. */
export type BoundedCache<K, V> = {
  get(key: K): V | undefined
  set(key: K, value: V): void
  /** Current entry count — exposed for tests and diagnostics. */
  readonly size: number
}

/**
 * Builds a cache that never grows past `limit` entries. The keys we memoize on
 * (JSONPath expressions, filter bodies, regex sources) all come from rulesets,
 * and a long-lived service that accepts a ruleset per request would otherwise
 * grow these maps forever — a slow leak that only shows up in production.
 *
 * Eviction is plain insertion-order (a `Map` iterates oldest first), not LRU: the
 * hot entries in a lint run are the handful of expressions a ruleset actually
 * uses, so anything fancier would cost more than it saves.
 */
export const createBoundedCache = <K, V>(limit: number): BoundedCache<K, V> => {
  const entries = new Map<K, V>()
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      if (entries.size >= limit && !entries.has(key)) {
        const oldest = entries.keys().next()
        if (!oldest.done) entries.delete(oldest.value)
      }
      entries.set(key, value)
    },
    get size() {
      return entries.size
    },
  }
}
