import { coercePrimitive } from './coerce-primitive'
import { defineOwnProperty } from './define-own-property'
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
    // The matcher already wrote `{__proto__}` as an own property; copying it
    // with a plain assignment would undo that and drop the capture.
    defineOwnProperty(
      params,
      key,
      coercion === 'number' || coercion === 'boolean' ? coercePrimitive(value, coercion) : value,
    )
  }
  return params
}
