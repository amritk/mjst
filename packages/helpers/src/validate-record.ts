import { isObject } from './is-object'

/**
 * Parses the values of a record with a parser function.
 * Uses for...in instead of Object.entries() to avoid allocating an intermediate array.
 */
export const validateRecord = (input: unknown, parser: (input: unknown) => unknown) => {
  if (!isObject(input)) {
    return {}
  }

  const record = input as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key in record) {
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
