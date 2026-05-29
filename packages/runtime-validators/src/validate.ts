import { compileCached } from '#compiler/compile-cached'

import type { ValidateOptions, Validator } from './types'

/**
 * Compiles a JSON Schema into a fast, error-collecting validator.
 *
 * Unlike `@amritk/generate-validators`, which writes validator *source files*
 * at build time from a schema you already know, this compiles a schema you only
 * discover at runtime into a specialized function — ideal for plugin configs,
 * user-supplied schemas, or anywhere the shape is not known ahead of time.
 *
 * The returned validator reports every error it finds, with a JSON Pointer path
 * to each one. If you only need a yes/no answer, reach for {@link validateGuard}:
 * it is meaningfully faster because it short-circuits and never allocates.
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
 * ```
 */
export const validate = (schema: unknown, options?: ValidateOptions): Validator => {
  return compileCached(schema, options, true) as Validator
}
