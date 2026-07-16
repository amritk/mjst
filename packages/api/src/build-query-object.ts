import { coercePrimitive } from './coerce-primitive'
import type { Coercion } from './types'

/**
 * Builds the query object a route's schema validates, in a single pass over
 * the search parameters. Keys with a plan entry are coerced to their declared
 * type; array-typed keys accumulate repeated occurrences (`?tag=a&tag=b`);
 * keys the schema does not declare pass through as strings so
 * `additionalProperties` / `patternProperties` rules still see them.
 */
export const buildQueryObject = (
  searchParams: URLSearchParams,
  coercions: ReadonlyMap<string, Coercion>,
): Record<string, unknown> => {
  const query: Record<string, unknown> = {}
  for (const [key, raw] of searchParams) {
    assignQueryPair(query, key, raw, coercions)
  }
  return query
}

/**
 * Applies one key/value pair to the query object under the coercion plan.
 * Shared with `buildQueryObjectFromString` so the fast string parser and the
 * URLSearchParams path agree on every coercion decision by construction.
 */
export const assignQueryPair = (
  query: Record<string, unknown>,
  key: string,
  raw: string,
  coercions: ReadonlyMap<string, Coercion>,
): void => {
  const coercion = coercions.get(key)
  switch (coercion) {
    case undefined:
      // A repeated undeclared key keeps its last value, mirroring the
      // common URLSearchParams.get-last convention.
      query[key] = raw
      break
    case 'number':
    case 'boolean':
      query[key] = coercePrimitive(raw, coercion)
      break
    case 'number-array':
      appendTo(query, key, coercePrimitive(raw, 'number'))
      break
    case 'boolean-array':
      appendTo(query, key, coercePrimitive(raw, 'boolean'))
      break
    case 'string-array':
      appendTo(query, key, raw)
      break
  }
}

const appendTo = (query: Record<string, unknown>, key: string, value: unknown): void => {
  const existing = query[key]
  if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    query[key] = [value]
  }
}
