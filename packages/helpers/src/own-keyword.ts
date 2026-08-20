/**
 * Reading a schema keyword as the node's *own* property — the two spellings of
 * one question, so the answer cannot differ between them.
 *
 * The generators walk documents the caller supplied, and `'items' in schema`
 * walks the prototype chain: with `Object.prototype.items` set — by a dependency
 * with a prototype-pollution bug, or by a schema built over a base object — every
 * node in the document answers "yes" to a keyword none of them declares. The
 * result is not one crash but a spread of them: an inherited `items: false` makes
 * every array have to be empty, an inherited `patternProperties` swallows the
 * `additionalProperties` sweep so unknown keys stop being reported, and an
 * inherited `if`/`then` or `contains` sends a walker into unbounded recursion,
 * because the value it reads inherits the keyword too.
 *
 * {@link ./schema-guards} asks `Object.hasOwn` for exactly this reason, and so
 * does `@amritk/runtime-validators`. This is the same question for the keywords
 * that have no named guard.
 */

/** True when the node declares `keyword` itself. */
export const declaresKeyword = (schema: object, keyword: string): boolean => Object.hasOwn(schema, keyword)

/**
 * The keyword's own value, or `undefined` when the node does not declare it.
 *
 * A declared `undefined` reads the same as an absent keyword, which is the
 * reading every caller here already wanted: no JSON document can hold one, and a
 * hand-built schema that does means "nothing here" rather than "an empty
 * subschema".
 */
export const ownKeyword = (schema: Record<string, unknown>, keyword: string): unknown =>
  Object.hasOwn(schema, keyword) ? schema[keyword] : undefined
