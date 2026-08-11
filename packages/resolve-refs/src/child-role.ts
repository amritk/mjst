/**
 * What a node *is* in the JSON Schema vocabulary, which is what decides whether
 * a `$ref` key inside it means anything.
 *
 * The resolvers used to walk documents purely structurally, so any object with a
 * string `$ref` was a reference wherever it sat. That is wrong in a value
 * position: `{ "enum": [ { "$ref": "#/$defs/a_string" } ] }` references nothing —
 * `enum` holds *instances*, and one of them happens to be an object with a
 * `$ref` key. Inlining it changes what the schema accepts, which is why the
 * official suite carries that case under "naive replacement of `$ref` with its
 * destination is not correct".
 */
export type NodeRole =
  /** A schema: its keys are keywords, and a `$ref` here is a reference. */
  | 'schema'
  /**
   * A map of arbitrary names to schemas (`properties`, `$defs`, …). Its keys are
   * names chosen by the author, so a definition named `enum` is a definition,
   * not the keyword — and a property named `$ref` is a property, not a reference.
   */
  | 'schemaMap'
  /** Instance data (`enum`, `const`, `default`, `examples`). Nothing in here is a keyword. */
  | 'value'
  /**
   * Outside any vocabulary we model — an extension keyword, or anything under
   * one. Walked structurally, exactly as the resolvers always have: we cannot
   * know what an unrecognized keyword holds, so we keep finding references in it.
   */
  | 'unknown'

/**
 * Keywords whose values are instances rather than schemas. These are the only
 * standard keywords that can hold an arbitrary object, so they are the only
 * places a `$ref`-shaped object can show up as data.
//
// Kept in step by hand with `@amritk/helpers`' `DATA_KEYWORDS`: this package
// takes no `@amritk/*` dependency by design, so the set is restated rather
// than imported. `example` is OpenAPI 3.0's singular spelling and belongs
// with `examples`.
 */
const VALUE_KEYWORDS = new Set(['enum', 'const', 'default', 'examples', 'example'])

/**
 * Keywords whose value is a map of author-chosen names to schemas. The names are
 * arbitrary, so nothing inside the map may be read as a keyword — that is the
 * trap in classifying by key alone.
 *
 * `dependencies` (draft-07) maps a name to a schema *or* an array of property
 * names; the array holds only strings, so treating it as a schema map is safe.
 */
const SCHEMA_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
])

/**
 * Keywords whose value is a schema, or an array of schemas — the applicators.
 * Both shapes are listed together because the walk treats an array in a schema
 * position as a list of schemas anyway, which also covers draft-07's tuple form
 * of `items`.
 */
const SCHEMA_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'allOf',
  'anyOf',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'oneOf',
  'prefixItems',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

/**
 * The role of the child at `key` (an object key, or an array index) inside a
 * node whose role is `role`.
 *
 * An array element inherits its array's role: the members of `allOf` are schemas
 * because `allOf` sits in a schema position, and the members of `enum` are data
 * because `enum` does not.
 *
 * Unrecognized keywords hand back `'unknown'`, and `'unknown'` is absorbing —
 * once the walk leaves the vocabulary it never claims to be back inside it. That
 * keeps extension keywords (OpenAPI's `components`, an `x-` vendor block)
 * behaving exactly as they did before roles existed.
 */
export const childRole = (role: NodeRole, key: string | number): NodeRole => {
  if (role === 'schemaMap') return 'schema'
  if (role !== 'schema') return role
  if (typeof key === 'number') return 'schema'
  if (VALUE_KEYWORDS.has(key)) return 'value'
  if (SCHEMA_MAP_KEYWORDS.has(key)) return 'schemaMap'
  if (SCHEMA_KEYWORDS.has(key)) return 'schema'
  return 'unknown'
}
