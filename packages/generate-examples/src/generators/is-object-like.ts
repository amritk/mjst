import {
  hasAdditionalProperties,
  hasPatternProperties,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * True when a schema describes an object even though it never says `type:
 * 'object'`.
 *
 * This mirrors `isObjectLikeSchema` in `@amritk/helpers/generate-type-definition`
 * — deliberately, and it has to keep mirroring it. That function decides the
 * *type* a generated file declares; this one decides the arbitrary and the
 * example. When they disagree the file does not compile: a schema of
 * `{ properties: { a: … }, required: ['a'] }` (which OpenAPI documents write
 * constantly, `type` omitted) got the type `{ a: string }` but an arbitrary of
 * `fc.anything()` and an example of `null`, neither of which fits it.
 *
 * The helper is not exported, so the rule is restated here rather than
 * duplicated by accident — the same arrangement `schema-validation.ts` has with
 * that package's keyword sets.
 */
export const isObjectLike = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  if (isObjectSchema(schema)) return true
  return hasPatternProperties(schema) || hasAdditionalProperties(schema) || ('if' in schema && 'then' in schema)
}
