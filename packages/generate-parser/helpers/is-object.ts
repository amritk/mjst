/**
 * Returns true if the provided value is a plain object.
 * Optimized for JSON data validation: checks that value is truthy, typeof object,
 * and not an array. This correctly handles all JSON value types.
 *
 * Examples:
 *   isObject({})                  // true
 *   isObject({ a: 1 })            // true
 *   isObject([])                  // false (Array)
 *   isObject(null)                // false
 *   isObject(123)                 // false
 *   isObject('string')            // false
 */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
