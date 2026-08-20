import { hasType, isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * True when a schema describes an object even though it never says `type:
 * 'object'`.
 *
 * This mirrors `isObjectLikeSchema` in `@amritk/helpers/generate-type-definition`
 * — deliberately, and it has to keep mirroring it *exactly*. That function
 * decides the *type* a generated file declares; this one decides the arbitrary
 * and the example. Wherever they disagree, the file does not compile.
 *
 * So the tests below are the presence of the key, not the shape of its value:
 * the helper asks `'patternProperties' in schema`, so a malformed
 * `"patternProperties": null` still makes the type an object, and answering "not
 * object-like" here emitted `null` against it. Likewise `properties` wins over
 * `type`, so `{ type: 'string', properties: … }` is typed as an object however
 * odd that reads — matching it is what keeps the file compiling.
 *
 * The helper is not exported, so the rule is restated here rather than
 * duplicated by accident — the same arrangement `schema-validation.ts` has with
 * that package's keyword sets.
 */
export const isObjectLike = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  const raw = schema as Record<string, unknown>
  // `Object.hasOwn` rather than `in`: the two differ only for a name inherited
  // from `Object.prototype`, which a parsed document cannot carry, and `hasOwn`
  // does not answer for `__proto__`.
  if (raw['type'] === 'object' || Object.hasOwn(raw, 'properties')) return true
  if (Object.hasOwn(raw, 'patternProperties') || Object.hasOwn(raw, 'additionalProperties')) return true
  return Object.hasOwn(raw, 'if') && Object.hasOwn(raw, 'then')
}

/**
 * True when a schema says something about its own value, rather than delegating
 * entirely to a combinator.
 *
 * `oneOf`/`anyOf` are constraints that sit *alongside* the node's other
 * keywords, not replacements for them, so a node that also declares a `type` or
 * an object shape has to contribute that to whatever branch is chosen. Reading
 * the branch on its own dropped the node's own `properties`, and the example
 * came out `null` against an object type.
 */
export const declaresOwnShape = (schema: JSONSchema): boolean =>
  hasType(schema) || Array.isArray((schema as { type?: unknown }).type) || isObjectLike(schema)

/**
 * True when two schemas declare `type`s no single value can satisfy at once.
 *
 * Merging a node's own keywords into each `oneOf`/`anyOf` branch can produce a
 * branch that contradicts them — `{ anyOf: [integer, null], type: 'integer' }`
 * arises whenever an `allOf` narrows a property that carried a nullable union.
 * `mergeAllOf` resolves a clash by letting the later branch win, so the `null`
 * branch survived as `fc.constant(null)` under a type the intersection had
 * already narrowed to `number`. A branch that cannot be satisfied is not a
 * choice; dropping it is what makes the union match the declared type.
 *
 * `integer` and `number` are not a clash — every integer is a number.
 */
export const typesConflict = (a: JSONSchema, b: JSONSchema): boolean => {
  if (!hasType(a) || !hasType(b) || a.type === b.type) return false
  const numeric = new Set(['integer', 'number'])
  return !(numeric.has(a.type) && numeric.has(b.type))
}
