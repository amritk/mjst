import { prepareValidator } from '@/interpreter/prepare'

import type { FromSchema } from './from-schema'
import type { ValidateOptions, Validator } from './types'

/**
 * Builds a fast, error-collecting validator for a JSON Schema.
 *
 * Unlike `@amritk/generate-validators`, which writes validator *source files*
 * at build time from a schema you already know, this handles a schema you only
 * discover at runtime — ideal for plugin configs, user-supplied schemas, or
 * anywhere the shape is not known ahead of time. The schema is interpreted
 * directly (no `new Function`, no build step), so the validator returns
 * immediately and runs anywhere, including under a strict CSP.
 *
 * The returned validator reports every error it finds, with a JSON Pointer path
 * to each one. If you only need a yes/no answer, reach for {@link validateGuard}:
 * it is meaningfully faster because it short-circuits and never allocates.
 *
 * The `const` type parameter infers the schema as a literal, so the returned
 * {@link Validator} carries the type of data it accepts — recover it with
 * {@link Infer}. No `as const` is needed at the call site; the inference site
 * supplies it.
 *
 * `$ref` resolves inside the schema you pass — JSON Pointers, `$anchor`s, and
 * any `$id` the document declares. To reference a *different* document, load it
 * yourself and register it under its URI with {@link ValidateOptions.schemas};
 * the package still never fetches and never reads a file, so this stays a pure,
 * synchronous function of its inputs. A `$ref` to a URI nobody registered throws
 * rather than quietly accepting anything.
 *
 * @example
 * ```typescript
 * const validator = validate({
 *   type: 'object',
 *   properties: { name: { type: 'string' } },
 *   required: ['name'],
 * })
 *
 * validator({ name: 'Ada' }) // true
 * validator({})              // { valid: false, errors: [{ message: "must have required property 'name'", path: '' }] }
 *
 * type Named = Infer<typeof validator> // { name: string }
 * ```
 *
 * @example Referencing another document you have already loaded
 * ```typescript
 * const validator = validate(
 *   { type: 'array', items: { $ref: 'https://example.com/user.json' } },
 *   { schemas: { 'https://example.com/user.json': userSchema } },
 * )
 * ```
 */
export const validate = <const S = unknown>(schema: S, options?: ValidateOptions): Validator<FromSchema<S>> => {
  return prepareValidator(schema, options, true) as Validator<FromSchema<S>>
}
