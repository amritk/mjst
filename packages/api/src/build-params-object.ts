import { coercePrimitive } from './coerce-primitive'
import type { Coercion } from './types'

/**
 * Applies a route's coercion plan to the raw string path parameters the
 * matcher captured. When the plan is empty (an all-string schema, the common
 * case) the captured object is returned as-is — no copy, no allocation.
 */
export const buildParamsObject = (
  raw: Readonly<Record<string, string>>,
  coercions: ReadonlyMap<string, Coercion>,
): Record<string, unknown> => {
  if (coercions.size === 0) return raw
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const coercion = coercions.get(key)
    params[key] = coercion === 'number' || coercion === 'boolean' ? coercePrimitive(value, coercion) : value
  }
  return params
}
