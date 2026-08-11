import { DATA_KEYWORDS } from '@amritk/helpers/build-resource-registry'

/**
 * Shared tuple normalization for the adapters whose upstream converter emits
 * JSON Schema in a shape the mjst pipeline does not key tuple validation off of.
 * The pipeline recognizes a tuple only by 2020-12 `prefixItems`; a draft-07
 * `items: [...]` array is treated as a plain array, so element types and length
 * go unvalidated downstream. Both functions walk the whole tree of *schemas*.
 */

/**
 * Keywords whose values are a map of author-chosen names to schemas. The map
 * itself is not a schema, and — this is the part that matters — its keys are
 * names, not keywords. A property genuinely called `default` or `examples` is
 * ordinary in OpenAPI-adjacent documents, so skipping {@link DATA_KEYWORDS} by
 * key name alone would skip that property's whole subtree and leave a real
 * tuple inside it unnormalized.
 */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])

/**
 * Walks the schema tree, applying `transform` to every schema node.
 *
 * The walk is position-aware rather than key-aware. At a schema node, the keys
 * are keywords, so {@link DATA_KEYWORDS} mark subtrees that hold instance data
 * and must be left alone: a Zod `.default({ items: ['a', 'b'] })` is a default
 * *value* with a property called `items`, and rewriting it produced the default
 * `{ prefixItems: ['a','b'], minItems: 2, items: false }` — a different value
 * than the author wrote, handed to consumers as theirs. Inside a
 * {@link SCHEMA_MAPS} entry the keys are names instead, so no keyword meaning
 * applies to them and every value is walked as a schema.
 */
const walkSchema = (node: unknown, transform: (schema: Record<string, unknown>) => void): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    // A keyword whose value is a list of schemas: `allOf`, `prefixItems`, …
    for (const item of node) walkSchema(item, transform)
    return
  }
  const obj = node as Record<string, unknown>
  transform(obj)
  for (const [key, value] of Object.entries(obj)) {
    if (DATA_KEYWORDS.has(key)) continue
    if (SCHEMA_MAPS.has(key)) walkSchemaMap(value, transform)
    else walkSchema(value, transform)
  }
}

/** Walks a name-to-schema map: every value is a schema, no key is a keyword. */
const walkSchemaMap = (node: unknown, transform: (schema: Record<string, unknown>) => void): void => {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return
  for (const value of Object.values(node as Record<string, unknown>)) walkSchema(value, transform)
}

/**
 * Rewrites draft-07 tuples (`items` as an array, with an optional
 * `additionalItems` rest element) into 2020-12 form: `items` becomes
 * `prefixItems`, and `additionalItems` becomes `items` (its schema, or `false`).
 * No-op on output that already uses `prefixItems`.
 */
export const normalizeDraftTuples = (node: unknown): void => {
  walkSchema(node, (obj) => {
    if (!Array.isArray(obj['items'])) return
    obj['prefixItems'] = obj['items']
    if ('additionalItems' in obj) {
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
    if (!Array.isArray(obj['prefixItems'])) return
    if (typeof obj['minItems'] !== 'number') obj['minItems'] = obj['prefixItems'].length
    // No `items` keyword means no rest element: the array may not exceed the
    // fixed tuple, so forbid additional items.
    if (!('items' in obj)) obj['items'] = false
  })
}
