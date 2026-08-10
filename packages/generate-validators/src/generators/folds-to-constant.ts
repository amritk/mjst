import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Keywords that describe a schema without constraining an instance. A node
 * carrying only these accepts everything, so the emitter's match expression for
 * it collapses to `true`.
 *
 * Membership is decided by what this emitter does, not by which vocabulary a
 * keyword belongs to. `format` and the `content*` family are annotations here —
 * the 2020-12 default, and what the interpreter does; `format` is pinned by
 * `format-annotation.test.ts`. `$defs` / `definitions` hold subschemas split
 * into their own files rather than applied here. `$id` / `$schema` / `$anchor` /
 * `$dynamicAnchor` / `$vocabulary` identify and scope, none of which this
 * generator acts on. `nullable`, `example`, `discriminator`, `xml` and
 * `externalDocs` are OpenAPI's, and only `nullable` has any effect — as a
 * rewrite into `anyOf` that, with no sibling type to widen, constrains nothing.
 *
 * The set is checked against the emitter by `folds-to-constant.test.ts`, which
 * is the only way it stays honest: adding a keyword the emitter *does* act on
 * would drop a branch that really is emitted, and that is the direction that
 * ends in an undefined identifier. Leaving one out merely keeps a branch alive.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  '$anchor',
  '$comment',
  '$defs',
  '$dynamicAnchor',
  '$id',
  '$schema',
  '$vocabulary',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'default',
  'definitions',
  'deprecated',
  'description',
  'discriminator',
  'example',
  'examples',
  'externalDocs',
  'format',
  'nullable',
  'readOnly',
  'title',
  'writeOnly',
  'xml',
])

/**
 * Whether a subschema's verdict is decidable without looking at the instance —
 * `true` when it accepts everything, `false` when it accepts nothing, and
 * `undefined` when it depends on the value.
 *
 * The emitter asks the same question by building the subschema's checks and
 * seeing whether any came out (`generateMatchesExpr` returns the literal
 * `'true'`), and folds the branch away when they did not. Anything reading the
 * emitter's *output* — which arms it emitted, which `validateX` calls it made —
 * has to agree with it, and a predicate that under-answers costs only a branch
 * kept alive, while one that over-answers drops a call that really is emitted.
 * Hence the conservative `undefined`: this recognises the spellings that are
 * decidable from the node alone and declines everything else.
 */
export const foldsToConstant = (schema: unknown): boolean | undefined => {
  if (schema === true) return true
  if (schema === false) return false
  // A number, a string, a null: not a schema, so there is no verdict to give.
  // What the emitter does with one is a separate question, and the caller's —
  // it skips the keyword outright rather than folding it either way.
  if (!isSchemaObject(schema as JSONSchema)) return undefined
  return Object.keys(schema as Record<string, unknown>).every((key) => ANNOTATION_KEYWORDS.has(key)) ? true : undefined
}
