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
