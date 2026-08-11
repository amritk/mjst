/**
 * Reads `key` off a map of author-chosen names, treating an inherited name as
 * absent.
 *
 * The maps this guards — `$defs`, a `$dynamicAnchor` index, a config-key table
 * — are keyed by names taken from a schema or a config file, so `__proto__`,
 * `constructor` and `toString` are all names an author may legitimately use.
 * A bare index answers those from `Object.prototype`, which is never what the
 * caller meant: `$defs.__proto__` hands back `Object.prototype` as though it
 * were a declared definition, and `map.toString` hands back a `Function` where
 * a schema was expected.
 */
export const readKey = <T>(source: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(source, key) ? source[key] : undefined
