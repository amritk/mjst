import type { FromSchema } from '@/from-schema'
import { resolveLimits } from '@/interpreter/limits'
import type { NodeMeta } from '@/interpreter/node-meta'
import { prepareValidator } from '@/interpreter/prepare'
import type { ValidationResult } from '@/types'

import { type CoerceContext, coerceToSchema } from './coerce'
import type { ParseOptions, ParseResult, Parser } from './types'

/**
 * Builds a parser for a JSON Schema: it **coerces** its input toward the schema,
 * then validates the result and hands it back.
 *
 * This is {@link validate}'s counterpart for data that did not arrive as JSON.
 * HTTP query strings, path segments, headers, form bodies, environment
 * variables and CSV rows all deliver every scalar as a string, so a schema
 * saying `{ type: 'integer' }` and an input saying `'42'` are describing the
 * same thing and only a parser can say so. `@amritk/generate-parsers` does this
 * at build time for a schema you already have; this does it for one you only
 * discover at runtime, under the same eval-free interpreter — no `new Function`,
 * no build step, so it runs under a strict CSP and on Workers.
 *
 * **Coercion never decides a verdict.** It converts and then defers: the
 * validator still judges the result in full, so a parse can only ever accept
 * something the validator would have accepted. Where a string does not actually
 * denote the type its subschema declares, the string is passed through
 * unchanged and rejected with a proper type error rather than guessed at.
 *
 * The conversions, applied only where a subschema names a single scalar `type`:
 *
 * | schema `type` | input | output |
 * | --- | --- | --- |
 * | `number` / `integer` | `'42'`, `'1.5'` | `42`, `1.5` |
 * | `number` / `integer` | `''`, `'abc'`, `'Infinity'` | unchanged (then rejected) |
 * | `boolean` | `'true'`, `'false'` | `true`, `false` |
 * | `null` | `'null'` | `null` |
 *
 * A node whose type is genuinely ambiguous — `type: ['number','string']`,
 * `anyOf`, `oneOf`, `if` — is never converted at, because `'42'` is a valid
 * value under the string branch of each and picking one would destroy it.
 * Structural descent continues regardless, so `properties` and `items` under
 * such a node still coerce.
 *
 * Absent object properties are filled from the `default` in their subschema
 * (deep-copied, so a caller mutating the result cannot corrupt a schema they
 * hold as a constant). Turn either half off with
 * {@link ParseOptions.coerce} / {@link ParseOptions.defaults}.
 *
 * Input is never mutated, and a value that already has the declared types comes
 * back as the very object that went in, so the already-JSON path allocates
 * nothing.
 *
 * `$ref` behaves as it does in {@link validate} for *validation*; for the
 * coercion half only refs local to the document — JSON Pointers and `$anchor`s —
 * are followed. Under a cross-document or `$id`-scoped ref the value passes
 * through uncoerced and is then validated in full, so the verdict is always
 * right and only the convenience is skipped.
 *
 * @example
 * ```typescript
 * const parseQuery = parse({
 *   type: 'object',
 *   properties: {
 *     page: { type: 'integer', default: 1 },
 *     verbose: { type: 'boolean' },
 *   },
 *   required: ['page'],
 * })
 *
 * parseQuery({ page: '3', verbose: 'true' }) // { ok: true, value: { page: 3, verbose: true } }
 * parseQuery({})                             // { ok: true, value: { page: 1 } }
 * parseQuery({ page: 'abc' })                // { ok: false, errors: [{ message: 'must be integer', path: '/page' }] }
 * ```
 */
export const parse = <const S = unknown>(schema: S, options?: ParseOptions): Parser<FromSchema<S>> => {
  const validator = prepareValidator(schema, options, true)
  const limits = resolveLimits(options?.limits)
  const coerce = options?.coerce ?? true
  const defaults = options?.defaults ?? true

  // Shared across every call of this parser, exactly as the validator's caches
  // are: the keyword metadata for a schema node never changes, so a reused
  // parser walks each node's keywords once for its whole lifetime.
  const meta = new WeakMap<object, NodeMeta>()

  // Nothing to convert and nothing to fill: the parse is a validation, and the
  // walk would be pure overhead on every call.
  const walk = coerce || defaults

  return ((input: unknown): ParseResult<FromSchema<S>> => {
    const ctx: CoerceContext = {
      root: schema,
      meta,
      coerce,
      defaults,
      maxDepth: limits.maxDepth,
      // A fresh budget per call — the ceiling is per-parse, not per-parser.
      maxSteps: limits.maxSteps,
      steps: 0,
    }
    const value = walk ? coerceToSchema(input, schema, ctx, 0) : input
    const result = validator(value) as ValidationResult
    if (result === true) return { ok: true, value: value as FromSchema<S> }
    return { ok: false, errors: result.errors }
  }) as Parser<FromSchema<S>>
}
