import { isObject } from './is-object'

/**
 * Parses the values of a record with a parser function.
 *
 * Own keys only. This runs on untrusted input at runtime, and a `for…in` walks
 * the prototype chain — so with a polluted `Object.prototype` the parsed record
 * came back carrying properties the input never had. `Object.keys` allocates an
 * array where `for…in` did not; that is the cheaper half of the trade, and it
 * is the form the interpreter's own benchmark measures fastest anyway.
 */
export const validateRecord = (input: unknown, parser: (input: unknown) => unknown) => {
  if (!isObject(input)) {
    return {}
  }

  const record = input as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    const value = parser(record[key])
    // A plain assignment of `__proto__` invokes the prototype setter and
    // corrupts `result`'s prototype (a prototype-pollution vector for untrusted
    // input). Define it as an own data property instead so it round-trips as a
    // normal key, matching every other property.
    if (key === '__proto__') {
      Object.defineProperty(result, key, { value, writable: true, enumerable: true, configurable: true })
    } else {
      result[key] = value
    }
  }

  return result
}
