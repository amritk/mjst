/**
 * Writes `value` under `key` on a plain record, even when the key is
 * `__proto__`.
 *
 * A plain `record[key] = value` runs `Object.prototype`'s `__proto__` setter
 * for that one name instead of creating a property, so the entry silently
 * disappears. Every slot the pipeline builds from client-supplied names —
 * cookies, headers, path parameters — hits this: a contract declaring a
 * `__proto__` cookie or header never sees its value, and `required:
 * ['__proto__']` fails on every request no matter what the client sent. The
 * read side already treats those names as ordinary data (`Object.hasOwn`), so
 * the write side has to as well.
 *
 * Note this is not a pollution hole either way — the setter ignores the string
 * values a header or cookie carries — but a silently dropped value is a real
 * bug. Same fix as `defineEntry` in `@amritk/generate-validators` and
 * `setMapKey` in `@amritk/yaml`; the query builders solve it differently, with
 * a null-prototype record, because they have no fixed set of declared names.
 */
export const defineOwnProperty = (record: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true })
    return
  }
  record[key] = value
}
