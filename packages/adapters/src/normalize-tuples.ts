import { entersSchemaMap, isDataPosition } from '@amritk/helpers/build-resource-registry'

/**
 * Shared tuple normalization for the adapters whose upstream converter emits
 * JSON Schema in a shape the mjst pipeline does not key tuple validation off of.
 * The pipeline recognizes a tuple only by 2020-12 `prefixItems`; a draft-07
 * `items: [...]` array is treated as a plain array, so element types and length
 * go unvalidated downstream. Both functions walk the whole tree of *schemas*.
 */

/**
 * Walks the schema tree, applying `transform` to every schema node.
 *
 * The position rule — which keys are keywords and which are author-chosen
 * names — comes from `isDataPosition`/`entersSchemaMap`, so this traversal
 * cannot drift from the walkers in `@amritk/helpers` that share them.
 */
const walkSchema = (node: unknown, transform: (schema: Record<string, unknown>) => void, inSchemaMap = false): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    // A keyword whose value is a list of schemas: `allOf`, `prefixItems`, …
    for (const item of node) walkSchema(item, transform, inSchemaMap)
    return
  }
  const obj = node as Record<string, unknown>
  if (!inSchemaMap) transform(obj)
  for (const key of Object.keys(obj)) {
    if (isDataPosition(key, inSchemaMap)) continue
    walkSchema(obj[key], transform, entersSchemaMap(key, inSchemaMap))
  }
}

/**
 * Rewrites draft-07 tuples (`items` as an array, with an optional
 * `additionalItems` rest element) into 2020-12 form: `items` becomes
 * `prefixItems`, and `additionalItems` becomes `items` (its schema, or `false`).
 * No-op on output that already uses `prefixItems`.
 */
export const normalizeDraftTuples = (node: unknown): void => {
  walkSchema(node, (obj) => {
    // Own key: a polluted `Object.prototype.items` array would otherwise make
    // every node take the tuple branch.
    if (!Object.hasOwn(obj, 'items') || !Array.isArray(obj['items'])) return
    obj['prefixItems'] = obj['items']
    // `Object.hasOwn`, not `in`: with `Object.prototype.additionalItems` set by
    // any dependency, a closed draft-07 tuple would take the rest-element
    // branch and come out open.
    if (Object.hasOwn(obj, 'additionalItems')) {
      // A rest element — its schema (or `false`) becomes `items`.
      obj['items'] = obj['additionalItems']
      delete obj['additionalItems']
    } else {
      // No rest element: drop `items` so `enforceTupleLength` forbids extras.
      delete obj['items']
    }
  })
}

/**
 * A fixed tuple expressed as a bare `prefixItems` array (no length bound) accepts
 * a too-short array (trailing positions unconstrained) and a too-long one
 * (nothing forbids extras). Restore the length: `minItems` forces the fixed
 * elements present, and — when the tuple has no rest element (no `items`) —
 * `items: false` forbids extras.
 *
 * Only a *missing* `minItems` is filled in. An explicit one is the author
 * saying which trailing positions are optional — Effect's `optionalElement`
 * emits exactly that — and raising it to the tuple's length made those
 * positions required, rejecting arrays the source schema accepts.
 */
export const enforceTupleLength = (node: unknown): void => {
  walkSchema(node, (obj) => {
    // Own key, for the same reason as `normalizeDraftTuples` above: otherwise
    // every node gains a tuple bound it never declared.
    if (!Object.hasOwn(obj, 'prefixItems') || !Array.isArray(obj['prefixItems'])) return
    const fixed = (obj['prefixItems'] as unknown[]).length
    // An empty tuple needs no floor, and stamping `minItems: 0` would put a
    // keyword in the output that the source schema never declared — visible in
    // the generated types, parsers and docs for every empty tuple a converter
    // emits. The previous `min < fixed` form never wrote it either.
    if (fixed > 0 && (!Object.hasOwn(obj, 'minItems') || typeof obj['minItems'] !== 'number')) obj['minItems'] = fixed
    // No `items` keyword means no rest element: the array may not exceed the
    // fixed tuple, so forbid additional items.
    // Likewise: a polluted `items` would make every tuple look like it had a
    // rest element, so `items: false` was never written and extras slipped
    // through — the exact under-validation this function closes.
    if (!Object.hasOwn(obj, 'items')) obj['items'] = false
  })
}
