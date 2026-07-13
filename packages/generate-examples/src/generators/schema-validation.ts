import { isSchemaObject } from '@amritk/helpers/schema-guards'
import { validateGuard } from '@amritk/runtime-validators'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Keywords the direct generators can't fully honour on their own, so a value they
 * produce must be re-checked against a real validator. `oneOf` is included because
 * neither path enforces its *exactly-one* exclusivity; `anyOf`/`allOf` are not,
 * since a single satisfied branch (already how they are generated) is enough.
 */
const FILTER_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'not',
  'oneOf',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'minProperties',
  'maxProperties',
  'contains',
])

/**
 * Keys whose values are *data* (or reference targets), not applied subschemas, so
 * a `not`/`if`/… appearing inside them must not be mistaken for an applicator.
 * `$defs`/`definitions` hold *unapplied* definitions — a hard keyword there only
 * matters once referenced, and each referenced def gets its own generated file.
 */
const SKIP_RECURSE = new Set(['enum', 'const', 'examples', 'default', '$ref', 'required', '$defs', 'definitions'])

/**
 * True when `schema` (anywhere in its applied subschema tree) uses a keyword the
 * direct generators can't guarantee, so the generated value must be run through a
 * validating filter. `$ref`s are not followed — a referenced definition is emitted
 * as its own self-validating file.
 */
export const needsValidationFilter = (schema: JSONSchema): boolean => {
  const walk = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(walk)
    if (node === null || typeof node !== 'object') return false
    const obj = node as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (FILTER_KEYWORDS.has(key)) return true
    }
    for (const [key, value] of Object.entries(obj)) {
      if (SKIP_RECURSE.has(key)) continue
      if (walk(value)) return true
    }
    return false
  }
  return walk(schema)
}

/**
 * Returns `schema` augmented with the root document's `$defs`/`definitions` so its
 * local `$ref`s (`#/$defs/…`) resolve when it is validated in isolation. The
 * schema's own definitions win on collision.
 */
export const withResolvableDefs = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
): Record<string, unknown> => {
  const base = isSchemaObject(schema) ? { ...schema } : { const: schema }
  if (!rootSchema) return base
  for (const key of ['$defs', 'definitions'] as const) {
    const rootDefs = rootSchema[key]
    if (rootDefs && typeof rootDefs === 'object') {
      base[key] = { ...(rootDefs as object), ...((base[key] as object) ?? {}) }
    }
  }
  return base
}

/**
 * Compiles a boolean validator for `schema` (with the root document's definitions
 * spliced in so local `$ref`s resolve). Used at generation time to accept/reject
 * candidate example values for keywords the deriver can't satisfy structurally.
 */
export const makeInstanceCheck = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
): ((value: unknown) => boolean) => {
  const guard = validateGuard(withResolvableDefs(schema, rootSchema))
  return (value: unknown) => guard(value) === true
}
