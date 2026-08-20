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

/**
 * True when `source` declares `key` itself — the presence half of the same
 * question {@link readKey} answers by value.
 *
 * A caller that only needs to know whether a keyword is *there* would otherwise
 * write `'items' in schema`, and `in` walks the prototype chain: with
 * `Object.prototype.items` set, every node in a document declares a keyword none
 * of them wrote, and what the generators emit from that is a different validator
 * — an inherited `items: false` capping every array at zero, an inherited `if`
 * sending a walk into unbounded recursion.
 */
export const declaresKey = (source: object, key: string): boolean => Object.hasOwn(source, key)
