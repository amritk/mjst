import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { tupleShapeOf } from './tuple-shape'
import { type UnevaluatedMatchFn, unevaluatedItemsExpr, unevaluatedPropertiesExpr } from './unevaluated-match'

/**
 * Recursively walks a schema and yields every `$ref` the validator emitter turns
 * into a `validateX(...)` call, in traversal order (duplicates included — the
 * callers dedupe on what they key by).
 *
 * The emitter recurses into far more than properties/items/additionalProperties
 * and the top-level combinators: it also delegates for `patternProperties`,
 * `propertyNames`, `if`/`then`/`else`, `contains`, `prefixItems`,
 * `dependentSchemas`, `not`, the `unevaluated*` subschemas, and objects nested
 * inside any combinator branch. A `$ref` reached by *any* of those paths becomes
 * a call in the output, so both the import collector and the generatability check
 * have to see exactly this set — which is why the traversal lives here rather
 * than in either of them.
 *
 * `$defs` / `definitions` are deliberately skipped: they are split into their own
 * generated files rather than inlined into this one.
 *
 * Pass `rootSchema` to also pick up the refs an `unevaluated*` keyword reaches.
 * Those are the one case where a call can appear in *this* file for a branch
 * written in *another* definition: working out what a node's `$ref` target
 * already evaluated means reading through that target's own `anyOf` / `oneOf` /
 * `if`, and each of those branches is emitted here as a condition. Without the
 * root document there is nothing to resolve the target against, so the extra
 * refs are simply not collected.
 */
export const collectEmittedRefs = (
  value: unknown,
  refs: string[] = [],
  rootSchema?: Record<string, unknown>,
): string[] => {
  if (typeof value !== 'object' || value === null) return refs

  if (Array.isArray(value)) {
    for (const item of value) collectEmittedRefs(item, refs, rootSchema)
    return refs
  }

  const schema = value as Record<string, unknown>

  // Run before the `$ref` short-circuit below: `{ $ref, unevaluatedProperties }`
  // is a real shape, and its coverage reaches past the ref the emitter delegates to.
  if (rootSchema !== undefined && ('unevaluatedProperties' in schema || 'unevaluatedItems' in schema)) {
    collectCoverageRefs(schema as JSONSchema, refs, rootSchema)
  }

  // A `$ref` is one check among the node's others, not the end of it: per
  // 2020-12 the siblings apply to the same value, and the emitter runs them
  // after the delegation. So record the ref and keep walking — a
  // `{ $ref, allOf: [{ $ref }] }` emits two calls, and treating the node as a
  // leaf collected only the first, leaving the second an undefined identifier.
  if (typeof schema['$ref'] === 'string') {
    refs.push(schema['$ref'])
  }

  // `properties` and `patternProperties` hold subschemas as object *values*; the
  // combinator/tuple keywords hold them in arrays; the rest are single
  // subschemas. `dependencies` (draft-07) is dual-form — a string array
  // (dependentRequired) or a subschema (dependentSchemas) — and the string form
  // is a harmless no-op here, since this self-guards on non-objects.
  for (const mapKey of ['properties', 'patternProperties', 'dependentSchemas', 'dependencies']) {
    const map = schema[mapKey]
    if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
      for (const sub of Object.values(map)) collectEmittedRefs(sub, refs, rootSchema)
    }
  }

  // The array positions come from the same normalisation the emitter reads, so
  // the two cannot disagree about which of `prefixItems` / `items` /
  // `additionalItems` is live. A node carrying both `prefixItems` and an array
  // `items` ignores the latter outright, and `additionalItems` means nothing
  // without an array `items` — a `$ref` inside an ignored keyword is a ref
  // nothing ever calls, which lands as a dead import (`TS6192` under this repo's
  // `noUnusedLocals`) or, when the walker cannot resolve it, as a refusal to
  // generate a schema that is perfectly fine.
  const { tuple, tail } = tupleShapeOf(schema)

  // `tail` stands where `items` used to, and `tuple` where `prefixItems` did, so
  // the traversal order every emitted import list is built from is unchanged.
  if (tail !== undefined) collectEmittedRefs(tail, refs, rootSchema)

  for (const key of [
    'additionalProperties',
    'propertyNames',
    'contains',
    'if',
    // `then` / `else` only apply when there is an `if` to branch on, and the
    // emitter skips them entirely without one.
    ...('if' in schema ? ['then', 'else'] : []),
    'not',
    // The `unevaluated*` subschemas are validated against the leftover keys /
    // indices, so a `$ref` inside one becomes a `validateX(...)` call like any
    // other — and without it the generated file would call an import it never asked for.
    'unevaluatedProperties',
    'unevaluatedItems',
  ]) {
    if (key in schema) collectEmittedRefs(schema[key], refs, rootSchema)
  }

  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const list = schema[key]
    if (Array.isArray(list)) {
      for (const sub of list) collectEmittedRefs(sub, refs, rootSchema)
    }
  }

  if (tuple !== undefined) for (const sub of tuple) collectEmittedRefs(sub, refs, rootSchema)

  return refs
}

/**
 * Records the refs the coverage expression for one `unevaluated*` node emits.
 *
 * Rather than re-derive which branches that expression visits — a traversal that
 * would drift from the real one the moment either changed — this runs the real
 * builder with a matcher that files away each subschema it is handed and answers
 * `'true'`. The expression it returns is thrown away; only the refs are kept.
 */
const collectCoverageRefs = (schema: JSONSchema, refs: string[], rootSchema: Record<string, unknown>): void => {
  const record: UnevaluatedMatchFn = (_accessor, sub) => {
    collectEmittedRefs(sub, refs)
    return 'true'
  }
  unevaluatedPropertiesExpr('_refs', schema, rootSchema, 0, record)
  unevaluatedItemsExpr('_refs', schema, rootSchema, 0, record)
}
