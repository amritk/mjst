import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Every keyword this generator turns into a runtime check. Annotations
 * (`title`, `description`, `default`, `$defs`, `format`, …) are deliberately
 * absent: they change no verdict, so a node carrying only those is still "just"
 * whatever its one validation keyword says.
 */
export const ENFORCED_KEYWORDS = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  MJST_EXTENSION_KEY,
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'items',
  'prefixItems',
  'additionalItems',
  'contains',
  'minContains',
  'maxContains',
  'minItems',
  'maxItems',
  'uniqueItems',
  'properties',
  'patternProperties',
  'additionalProperties',
  'required',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'minProperties',
  'maxProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
])

/**
 * True when a node declares an enforced keyword outside the set an emitter
 * `owns`.
 *
 * The specialised emitters — the top-level `$ref` delegation, the `const` and
 * `enum` roots, the flat boolean guards — each recognise one keyword and write
 * out a shape built around it. That shape has nowhere to put a sibling, so every
 * one of them used to drop the siblings silently: `{ $ref, minLength: 3 }`
 * accepted `"q"`, `{ type: 'string', const: 1 }` accepted `1`. Asking this first
 * lets each of them keep its tight output for the node it really does describe,
 * and hand anything richer to the general path.
 */
export const declaresKeywordOutside = (schema: JSONSchema, owned: readonly string[]): boolean => {
  if (!isSchemaObject(schema)) return false
  for (const keyword of Object.keys(schema as Record<string, unknown>)) {
    if (owned.includes(keyword)) continue
    if (ENFORCED_KEYWORDS.has(keyword)) return true
  }
  return false
}

/**
 * True when a subschema accepts every instance, so the emitter folds it away
 * rather than emitting a condition — a `true` schema, or one carrying nothing
 * but annotations.
 *
 * Deliberately *narrower* than the emitter's own test, which also folds a node
 * whose keywords happen to produce no checks. The two callers want opposite
 * safety margins: the emitter drops work, while `collectEmittedRefs` decides
 * whether a `$ref` inside the branch still becomes a call. Answering "yes" too
 * often there would leave an import missing and the output referencing a name
 * nothing defines; answering "no" too often only leaves an unused import. So
 * this errs towards "no", and every schema it does answer "yes" for is one the
 * emitter is certain to fold.
 */
export const matchesEverything = (schema: unknown): boolean => {
  if (schema === true) return true
  if (!isSchemaObject(schema as JSONSchema)) return false
  return !declaresKeywordOutside(schema as JSONSchema, [])
}
