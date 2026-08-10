import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Keywords that describe a schema without constraining an instance. A node
 * carrying only these accepts everything, so the emitter's match expression for
 * it collapses to `true`.
 *
 * `format` belongs here because this generator treats it as an annotation, the
 * 2020-12 default and the interpreter's behaviour — pinned by
 * `format-annotation.test.ts`. `$defs` / `definitions` hold subschemas that are
 * split into their own files rather than applied here, and `$id` / `$schema`
 * identify the document. Anything absent from this set is assumed to constrain
 * something, which is the safe direction: it keeps a branch alive.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  '$comment',
  '$defs',
  '$id',
  '$schema',
  'default',
  'definitions',
  'deprecated',
  'description',
  'examples',
  'format',
  'readOnly',
  'title',
  'writeOnly',
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
  // A non-schema (a number, a string, a null) is not an applicator; the emitter
  // reads it as no constraint at all.
  if (!isSchemaObject(schema as JSONSchema)) return true
  return Object.keys(schema as Record<string, unknown>).every((key) => ANNOTATION_KEYWORDS.has(key)) ? true : undefined
}
