/**
 * Shared tuple normalization for the adapters whose upstream converter emits
 * JSON Schema in a shape the mjst pipeline does not key tuple validation off of.
 * The pipeline recognizes a tuple only by 2020-12 `prefixItems`; a draft-07
 * `items: [...]` array is treated as a plain array, so element types and length
 * go unvalidated downstream. Both functions walk the whole tree.
 */

/**
 * Rewrites draft-07 tuples (`items` as an array, with an optional
 * `additionalItems` rest element) into 2020-12 form: `items` becomes
 * `prefixItems`, and `additionalItems` becomes `items` (its schema, or `false`).
 * No-op on output that already uses `prefixItems`.
 */
export const normalizeDraftTuples = (node: unknown): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) normalizeDraftTuples(item)
    return
  }
  const obj = node as Record<string, unknown>
  if (Array.isArray(obj['items'])) {
    obj['prefixItems'] = obj['items']
    if ('additionalItems' in obj) {
      // A rest element — its schema (or `false`) becomes `items`.
      obj['items'] = obj['additionalItems']
      delete obj['additionalItems']
    } else {
      // No rest element: drop `items` so `enforceTupleLength` forbids extras.
      delete obj['items']
    }
  }
  for (const value of Object.values(obj)) normalizeDraftTuples(value)
}

/**
 * A fixed tuple expressed as a bare `prefixItems` array (no length bound) accepts
 * a too-short array (trailing positions unconstrained) and a too-long one
 * (nothing forbids extras). Restore the length: `minItems` forces the fixed
 * elements present, and — when the tuple has no rest element (no `items`) —
 * `items: false` forbids extras. Applied to every `prefixItems` node; existing
 * tighter bounds are never loosened.
 */
export const enforceTupleLength = (node: unknown): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) enforceTupleLength(item)
    return
  }
  const obj = node as Record<string, unknown>
  if (Array.isArray(obj['prefixItems'])) {
    const fixed = obj['prefixItems'].length
    const min = typeof obj['minItems'] === 'number' ? obj['minItems'] : 0
    if (min < fixed) obj['minItems'] = fixed
    // No `items` keyword means no rest element: the array may not exceed the
    // fixed tuple, so forbid additional items.
    if (!('items' in obj)) obj['items'] = false
  }
  for (const value of Object.values(obj)) enforceTupleLength(value)
}
