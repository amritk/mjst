import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { canMatchSubschema } from './subschema-match'

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
 *  - `unevaluatedProperties` / `unevaluatedItems` with a constraining value
 *    (`false` or a subschema). The generator has no support for the "which
 *    properties/items were evaluated" bookkeeping these require; only the
 *    runtime interpreter does. A `true` value permits everything and is allowed.
 *
 *  - `contains`, `propertyNames`, or `dependentSchemas` whose subschema uses a
 *    form {@link canMatchSubschema} cannot prove inline (a `$ref`, a combinator,
 *    a schema-valued record, …). The parser enforces these keywords only for
 *    subschemas it can match exactly; anything else would be silently ignored.
 *
 * This runs for strict generation only — coercing parsers are documented to be
 * permissive (they repair rather than reject), so ignoring these keywords there
 * is the contract, not a lie.
 */
export const assertNoUnsupportedKeywords = (schema: JSONSchema, typeName: string): void => {
  const fail = (keyword: string, detail: string): never => {
    throw new Error(
      `[${typeName}] unsupported keyword "${keyword}": the strict parser generator ${detail}, and would ` +
        `silently accept documents the schema rejects. Generate a coercing (non-strict) parser, validate this ` +
        `schema with @amritk/generate-validators, or remove the keyword.`,
    )
  }

  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const record = node as Record<string, unknown>

    for (const keyword of ['unevaluatedProperties', 'unevaluatedItems'] as const) {
      // `true` permits everything → no constraint → safe to ignore.
      if (keyword in record && record[keyword] !== true) {
        fail(keyword, 'does not implement it')
      }
    }

    if ('contains' in record && !canMatchSubschema(record['contains'] as JSONSchema)) {
      fail('contains', 'cannot prove its subschema inline')
    }

    if ('propertyNames' in record && isSchemaObject(record['propertyNames'] as JSONSchema)) {
      if (!canMatchSubschema(record['propertyNames'] as JSONSchema)) {
        fail('propertyNames', 'cannot prove its subschema inline')
      }
    }

    const dependentSchemas = record['dependentSchemas']
    if (typeof dependentSchemas === 'object' && dependentSchemas !== null && !Array.isArray(dependentSchemas)) {
      for (const sub of Object.values(dependentSchemas as Record<string, unknown>)) {
        // Boolean subschemas are enforced directly (see generateDependentSchemasChecks).
        if (typeof sub === 'boolean') continue
        if (!canMatchSubschema(sub as JSONSchema)) {
          fail('dependentSchemas', 'cannot prove one of its subschemas inline')
        }
      }
    }

    for (const value of Object.values(record)) visit(value)
  }

  visit(schema)
}
