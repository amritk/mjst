import { declaresKeyword, ownKeyword } from '@amritk/helpers/own-keyword'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { type UnevaluatedMatchFn, unevaluatedItemsExpr, unevaluatedPropertiesExpr } from './unevaluated-match'

/**
 * The message a node gets when its coverage cannot be worked out inline. Shared
 * with the emitter so the gate and the code path it guards say the same thing.
 */
export const UNPROVABLE_COVERAGE_MESSAGE = (keyword: string): string =>
  `unsupported "${keyword}": working out which keys the schema already evaluated means reading through an ` +
  'applicator this generator cannot follow inline — an unresolvable or cyclic "$ref", or a "$dynamicRef", whose ' +
  'target is only known at validation time. Validate this schema with `@amritk/runtime-validators` instead.'

/** Keywords holding one subschema that the validator emitter enforces. */
const SINGLE_SUBSCHEMA_KEYS = [
  'additionalProperties',
  'propertyNames',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
] as const

/** Keywords holding an array of subschemas that the validator emitter enforces. */
const SUBSCHEMA_LIST_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const

/** Keywords holding a map of named subschemas that the validator emitter enforces. */
const SUBSCHEMA_MAP_KEYS = ['properties', 'patternProperties', 'dependentSchemas', 'dependencies'] as const

/**
 * Whether `additionalItems` is the live tail of this node, and so a position the
 * emitter really does enforce.
 *
 * It is exactly when `items` holds the tuple — the draft-07 spelling — and
 * `prefixItems` has not taken the positions out from under it. Everywhere else
 * `additionalItems` is inert (2020-12 does not define it, and `tuple-shape.ts`
 * reads the tail from `items` instead), so a constraining keyword written there
 * is silently ignored and an `unevaluated*` under it has to refuse rather than
 * be dropped.
 *
 * The generator used to read `additionalItems` only as `false`, a length cap,
 * which made the whole position unenforced and this refusal always right. Now
 * that the draft-07 tail is validated, refusing a schema written in that
 * spelling would be turning down work the emitter can do — and the 2020-12
 * spelling of the very same schema generates.
 */
const additionalItemsIsEnforced = (node: Record<string, unknown>): boolean =>
  Array.isArray(ownKeyword(node, 'items')) && !Array.isArray(ownKeyword(node, 'prefixItems'))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Refuses one `unevaluated*`-carrying node, or returns quietly when it is generatable. */
const check = (
  node: JSONSchema,
  typeName: string,
  rootSchema: Record<string, unknown> | undefined,
  match: UnevaluatedMatchFn,
  enforced: boolean,
): void => {
  const record = node as Record<string, unknown>
  for (const keyword of ['unevaluatedProperties', 'unevaluatedItems'] as const) {
    // `true` permits everything, so it constrains nothing and cannot be wrong.
    if (!declaresKeyword(record, keyword) || record[keyword] === true) continue
    if (!enforced) {
      throw new Error(
        `[${typeName}] unsupported "${keyword}": it sits under "additionalItems", a subschema position this ` +
          'generator does not enforce, so the check would never run. Validate this schema with ' +
          '`@amritk/runtime-validators` instead.',
      )
    }
    const expression =
      keyword === 'unevaluatedProperties'
        ? unevaluatedPropertiesExpr('_probe', node, rootSchema, 0, match)
        : unevaluatedItemsExpr('_probe', node, rootSchema, 0, match)
    if (expression === null) throw new Error(`[${typeName}] ${UNPROVABLE_COVERAGE_MESSAGE(keyword)}`)
  }
}

/**
 * Throws when a schema uses `unevaluatedProperties` / `unevaluatedItems` in a way
 * the generated code cannot honour.
 *
 * Both keywords police whatever a value's *other* keywords left untouched, which
 * the interpreter answers with annotations gathered during its walk. Generated
 * code has no walk, so `unevaluated-match.ts` reconstructs the same answer as an
 * expression — and where it cannot (a `$ref` that resolves to nothing or back to
 * itself, a `$dynamicRef` whose target is only known at runtime, or a position
 * this generator does not enforce at all), generation stops here.
 *
 * That is deliberately a refusal *per shape* rather than per keyword: the vast
 * majority of `unevaluated*` schemas are expressible and are now generated. What
 * is left is the handful the flat form genuinely cannot see through, and for
 * those a build error is the honest report — far better than a validator that
 * accepts documents the interpreter rejects.
 *
 * `$defs` / `definitions` are skipped: a referenced definition is generated as
 * its own file and gated there, with its own fresh annotation scope (which is
 * also what the spec says a `$ref` target gets), and an unreferenced one is never
 * applied to anything.
 */
export const assertUnevaluatedGeneratable = (
  schema: JSONSchema,
  typeName: string,
  rootSchema: Record<string, unknown> | undefined,
  match: UnevaluatedMatchFn,
): void => {
  const visit = (node: unknown, enforced: boolean): void => {
    if (!isRecord(node)) return

    if (declaresKeyword(node, 'unevaluatedProperties') || declaresKeyword(node, 'unevaluatedItems')) {
      check(node as JSONSchema, typeName, rootSchema, match, enforced)
    }

    for (const key of SINGLE_SUBSCHEMA_KEYS) {
      if (declaresKeyword(node, key)) visit(node[key], enforced)
    }
    // `items` is a single subschema in 2020-12 and a tuple in the older drafts.
    const items = ownKeyword(node, 'items')
    if (Array.isArray(items)) for (const entry of items) visit(entry, enforced)
    else if (items !== undefined) visit(items, enforced)

    for (const key of SUBSCHEMA_LIST_KEYS) {
      const list = ownKeyword(node, key)
      if (Array.isArray(list)) for (const entry of list) visit(entry, enforced)
    }
    for (const key of SUBSCHEMA_MAP_KEYS) {
      const map = ownKeyword(node, key)
      if (!isRecord(map)) continue
      // The array form of draft-07 `dependencies` lists required keys, not schemas.
      for (const entry of Object.values(map)) if (!Array.isArray(entry)) visit(entry, enforced)
    }
    if (declaresKeyword(node, 'additionalItems'))
      visit(node['additionalItems'], enforced && additionalItemsIsEnforced(node))
  }

  visit(schema, true)
}
