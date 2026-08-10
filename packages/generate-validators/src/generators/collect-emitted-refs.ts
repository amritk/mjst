import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { foldsToConstant } from './folds-to-constant'
import { tupleShapeOf } from './tuple-shape'
import { type UnevaluatedMatchFn, unevaluatedItemsExpr, unevaluatedPropertiesExpr } from './unevaluated-match'

/**
 * Which `if` arms are live. Without an `if` neither arm applies at all; with one
 * whose verdict is decidable from the node alone, only the arm it selects does.
 * Anything else keeps both.
 *
 * The question has to be the one the *emitter* asks — it folds on whether the
 * `if`'s match expression came out constant, which `{}` and an annotation-only
 * schema do as surely as a literal `true`. Deciding only the literals left the
 * two out of step: the `else` arm of an `if: {}` was collected although nothing
 * emits it, which is a wholly unused import — and, because
 * `assertGeneratableRefs` reads this same set, a hard refusal to generate when
 * that arm's `$ref` happened to be unresolvable.
 */
const armsOf = (schema: Record<string, unknown>): string[] => {
  if (!('if' in schema)) return []
  const decided = foldsToConstant(schema['if'])
  if (decided === true) return ['then']
  if (decided === false) return ['else']
  return ['then', 'else']
}

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
  includeTypeOnly = false,
): string[] => {
  if (typeof value !== 'object' || value === null) return refs

  if (Array.isArray(value)) {
    for (const item of value) collectEmittedRefs(item, refs, rootSchema, includeTypeOnly)
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
      for (const sub of Object.values(map)) collectEmittedRefs(sub, refs, rootSchema, includeTypeOnly)
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
  if (tail !== undefined) collectEmittedRefs(tail, refs, rootSchema, includeTypeOnly)

  // Positions the *type* reads and the validator does not. `getTuplePositions` in
  // `generate-type-definition` prefers a non-empty `prefixItems` and otherwise
  // falls back to an array `items`, then takes the rest from `additionalItems`
  // whenever `items` is an array — so where `tupleShapeOf` and it disagree, the
  // type still names a `$ref` nothing calls. Each emitted import carries the type
  // as well as the validator, so those refs have to be in the list, or the output
  // gets `export type Root = [string?, ...B[]]` with no `B` in scope.
  //
  // Only for the import list, though: `assertGeneratableRefs` reads this set to
  // ask "would the emitter call a validator that was never generated", and the
  // answer for a type-only position is no. An unresolvable ref there types as
  // `unknown` and names nothing, so refusing over it turns down a schema that
  // generates fine.
  if (includeTypeOnly && Array.isArray(schema['items'])) {
    const arrayItems = schema['items'] as unknown[]
    // `getTuplePositions` falls back to the array `items` only when `prefixItems`
    // is absent or *empty*; a non-empty one wins there too, and then nothing reads
    // the array `items` at all.
    if (arrayItems !== tuple && tuple?.length === 0) {
      for (const sub of arrayItems) collectEmittedRefs(sub, refs, rootSchema, includeTypeOnly)
    }
    const additional = schema['additionalItems']
    if (additional !== undefined && additional !== tail) {
      collectEmittedRefs(additional, refs, rootSchema, includeTypeOnly)
    }
  }

  for (const key of [
    'additionalProperties',
    'propertyNames',
    'contains',
    'if',
    // `then` / `else` only apply when there is an `if` to branch on, and neither
    // emitter reads them without one — so a `$ref` there is never referenced,
    // and collecting it refused schemas whose ref happened to be unresolvable.
    //
    // An `if` the emitter can decide picks its arm here too, and unlike `anyOf`
    // the type generator reads neither arm — it types the whole node `unknown` —
    // so the dropped arm is referenced by nobody. See {@link armsOf}.
    ...armsOf(schema),
    'not',
    // The `unevaluated*` subschemas are validated against the leftover keys /
    // indices, so a `$ref` inside one becomes a `validateX(...)` call like any
    // other — and without it the generated file would call an import it never asked for.
    'unevaluatedProperties',
    'unevaluatedItems',
  ]) {
    if (key in schema) collectEmittedRefs(schema[key], refs, rootSchema, includeTypeOnly)
  }

  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const list = schema[key]
    if (!Array.isArray(list)) continue
    for (const sub of list) collectEmittedRefs(sub, refs, rootSchema, includeTypeOnly)
  }

  if (tuple !== undefined) for (const sub of tuple) collectEmittedRefs(sub, refs, rootSchema, includeTypeOnly)

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
