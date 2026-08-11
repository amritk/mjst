/**
 * Assigns `value` under `key` on a rebuilt object without letting a `__proto__`
 * key reach the prototype setter.
 *
 * Every walker in this package rebuilds schema objects key by key, and a
 * schema may legitimately describe a property named `__proto__`. A plain
 * `target[key] = value` on that key sets the rebuilt object's *prototype*
 * instead of adding a property: the key disappears from the output — a
 * declared property silently gone, along with every constraint on it — and the
 * object starts inheriting the subschema's own keys, so a later `node.$ref` or
 * `node.type` reads a value the node never had.
 *
 * Defining it as an own data property keeps the key verbatim and leaves the
 * prototype alone. `@amritk/resolve-refs` carries the same helper for the same
 * reason; the two are deliberately identical.
 */
export const assignKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    target[key] = value
  }
}

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
