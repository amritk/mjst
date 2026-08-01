import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { backstopReason, backstopSchema, type StrictAssertionContext } from './generate-strict-assertion'
import { canMatchSubschema } from './subschema-match'

/** Keywords whose value is a schema (or, for `items`/`prefixItems`, a list of them). */
const SUBSCHEMA_KEYS: readonly string[] = [
  'items',
  'prefixItems',
  'additionalItems',
  'contains',
  'additionalProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'not',
  'if',
  'then',
  'else',
  'allOf',
  'anyOf',
  'oneOf',
  'contentSchema',
]

/** Keywords whose value is a *map* of schemas. */
const SUBSCHEMA_MAP_KEYS: readonly string[] = [
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
]

/**
 * Throws when a schema (anywhere in its subtree) uses a keyword the *strict*
 * parser generator cannot enforce but which narrows the set of valid documents.
 * Mirrors generate-validators' `assertNoUnsupportedKeywords`: failing loudly at
 * generation time is strictly better than silently emitting a parser that
 * accepts input the schema forbids — a strict parser promises to "throw on
 * violations".
 *
 * Two families are rejected:
 *
 *  - `contains`, `not`, `propertyNames`, or `dependentSchemas` whose subschema
 *    uses a form {@link canMatchSubschema} cannot prove inline (a cyclic `$ref`,
 *    an unknown keyword). The parser enforces these keywords only for subschemas
 *    it can match exactly; anything else would be silently ignored.
 *
 *  - A node whose enforcement rests on the whole-schema backstop (see
 *    {@link backstopReason} — `unevaluatedProperties` / `unevaluatedItems`, a
 *    `$ref` nothing delegates, a type-less constraint) when the matcher cannot
 *    build that backstop.
 *
 * Everything the matcher *can* prove is enforced rather than refused, which is
 * why `unevaluated*` and `$ref`-carrying subschemas no longer fail outright.
 *
 * This runs for strict generation only — coercing parsers are documented to be
 * permissive (they repair rather than reject), so ignoring these keywords there
 * is the contract, not a lie.
 */
export const assertNoUnsupportedKeywords = (
  schema: JSONSchema,
  typeName: string,
  context: StrictAssertionContext = {},
): void => {
  const rootSchema = context.rootSchema ?? (isSchemaObject(schema) ? (schema as Record<string, unknown>) : undefined)
  const provable = (sub: JSONSchema): boolean => canMatchSubschema(sub, rootSchema)

  const fail = (keyword: string, detail: string): never => {
    throw new Error(
      `[${typeName}] unsupported keyword "${keyword}": the strict parser generator ${detail}, and would ` +
        `silently accept documents the schema rejects. Generate a coercing (non-strict) parser, validate this ` +
        `schema with @amritk/generate-validators, or remove the keyword.`,
    )
  }

  const visit = (node: unknown): void => {
    // Only *schemas* carry keywords. Walking every object indiscriminately (which
    // is what this did) reads a `properties` map as one, so a schema declaring a
    // property named `items`, `not`, or `contains` was checked as though the
    // property name were the keyword — and a perfectly ordinary order schema
    // failed to generate.
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    const record = node as Record<string, unknown>

    if ('contains' in record && !provable(record['contains'] as JSONSchema)) {
      fail('contains', 'cannot prove its subschema inline')
    }

    // `not` joins the same family: it is enforced through the exact matcher, so
    // a subschema the matcher cannot prove would leave the exclusion unchecked.
    if ('not' in record && !provable(record['not'] as JSONSchema)) {
      fail('not', 'cannot prove its subschema inline')
    }

    if ('propertyNames' in record && isSchemaObject(record['propertyNames'] as JSONSchema)) {
      if (!provable(record['propertyNames'] as JSONSchema)) {
        fail('propertyNames', 'cannot prove its subschema inline')
      }
    }

    const dependentSchemas = record['dependentSchemas']
    if (typeof dependentSchemas === 'object' && dependentSchemas !== null && !Array.isArray(dependentSchemas)) {
      for (const sub of Object.values(dependentSchemas as Record<string, unknown>)) {
        // Boolean subschemas are enforced directly (see generateDependentSchemasChecks).
        if (typeof sub === 'boolean') continue
        if (!provable(sub as JSONSchema)) {
          fail('dependentSchemas', 'cannot prove one of its subschemas inline')
        }
      }
    }

    // Keywords with no per-property assertion of their own: their only
    // enforcement is the backstop, so an unprovable node means the keyword would
    // vanish.
    const reason = backstopReason(node as JSONSchema, context)
    if (reason !== null && !provable(backstopSchema(node as JSONSchema, reason))) {
      fail(reason, 'cannot prove the schema it appears in inline')
    }

    // Recurse through the keywords whose values are schemas — never through
    // arbitrary keys, which are data (a `const`, an `enum` member, an `examples`
    // entry) rather than subschemas.
    for (const keyword of SUBSCHEMA_KEYS) {
      const value = record[keyword]
      if (value === undefined) continue
      // `items` is a single schema in 2020-12 and a tuple in draft-07; both
      // spellings reach their element schemas from here.
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
      } else {
        visit(value)
      }
    }
    for (const keyword of SUBSCHEMA_MAP_KEYS) {
      const value = record[keyword]
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      for (const sub of Object.values(value as Record<string, unknown>)) visit(sub)
    }
  }

  visit(schema)
}
