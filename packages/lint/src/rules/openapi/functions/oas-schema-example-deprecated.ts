import type { RulesetFunction } from '../../../core'
import { isObject } from './helpers'

// JSON Schema keywords that mark an object as a Schema Object (vs. a Media Type
// or Parameter Object, whose singular `example` is *not* deprecated in 3.1+).
const SCHEMA_KEYWORDS = new Set([
  'type',
  'properties',
  'items',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'enum',
  'format',
  'required',
  'additionalProperties',
  'patternProperties',
  'prefixItems',
  '$ref',
])

/**
 * Flags a Schema Object's singular `example`, deprecated in OpenAPI 3.1 (JSON
 * Schema 2020-12) in favor of the `examples` array. Targets the parent of an
 * `example` key (`$..example^`); to avoid false positives it only fires when the
 * parent looks like a Schema Object — it carries a JSON Schema keyword and is not
 * a Media Type / Parameter / Header object (those have a `schema` field and keep
 * a valid singular `example`).
 */
export const oasSchemaExampleDeprecated: RulesetFunction = (input, _options, context) => {
  if (!isObject(input) || input['example'] === undefined) return []
  if ('schema' in input) return []
  const looksLikeSchema = Object.keys(input).some((key) => SCHEMA_KEYWORDS.has(key))
  if (!looksLikeSchema) return []
  return [
    {
      message: 'Schema "example" is deprecated in OpenAPI 3.1; use "examples" instead.',
      path: [...context.path, 'example'],
    },
  ]
}
