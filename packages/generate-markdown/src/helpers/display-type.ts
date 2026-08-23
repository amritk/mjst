import { asArray, asSchema } from '#helpers/guards'
import type { SchemaProperty } from '#types/schema'

/** Maps a JSON value to the JSON Schema type name that best describes it. */
export const jsonTypeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Joins type names into a `a | b` union, dropping blanks and duplicates. */
export const unionOf = (parts: readonly string[]): string =>
  [...new Set(parts.filter((part) => part.length > 0))].join(' | ')

/**
 * Derives the type label to show for a property. Prefers the declared `type`
 * (string or `["string","null"]` union) and otherwise infers one from the
 * composition keywords real schemas use instead — `enum`, `const`, and
 * `anyOf`/`oneOf`/`allOf` — falling back to `object`/`array` when the shape is
 * implied by `properties`/`items`. Returns an empty string when nothing applies.
 */
export const displayType = (prop: SchemaProperty): string => {
  if (typeof prop.type === 'string') return prop.type
  if (Array.isArray(prop.type)) return unionOf(prop.type.filter((entry): entry is string => typeof entry === 'string'))
  if (asArray(prop.enum).length > 0) return unionOf(asArray(prop.enum).map(jsonTypeOf))
  if (prop.const !== undefined) return jsonTypeOf(prop.const)
  // A declared `type` is shown verbatim, so `["string","null"]` keeps its `null`;
  // an *inferred* label drops it, because the branch that exists only to allow
  // null (`anyOf: [{$ref: …}, {type: "null"}]`) is noise next to the real shape.
  for (const variants of [prop.anyOf, prop.oneOf, prop.allOf]) {
    const union = unionOf(
      asArray(variants)
        .map((variant) => displayType(asSchema(variant)))
        .filter((type) => type !== 'null'),
    )
    if (union.length > 0) return union
  }
  if (prop.properties) return 'object'
  if (prop.items !== undefined) return 'array'
  return ''
}
