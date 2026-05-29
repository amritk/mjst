import { compileCached } from '#compiler/compile-cached'

import type { CompileOptions, Validator } from './types'

/**
 * Compiles a JSON Schema into a fast, error-collecting validator.
 *
 * Unlike `@amritk/generate-validators`, which writes validator *source files*
 * at build time from a schema you already know, this compiles a schema you only
 * discover at runtime into a specialized function — ideal for plugin configs,
 * user-supplied schemas, or anywhere the shape is not known ahead of time.
 *
 * The returned validator reports every error it finds, with a JSON Pointer path
 * to each one. If you only need a yes/no answer, reach for {@link compileGuard}:
 * it is meaningfully faster because it short-circuits and never allocates.
 *
 * @example
 * ```typescript
 * const validate = compile({
 *   type: 'object',
 *   properties: { name: { type: 'string' } },
 *   required: ['name'],
 * })
 *
 * validate({ name: 'Ada' }) // true
 * validate({})              // { valid: false, errors: [{ message: "must have required property 'name'", path: '' }] }
 * ```
 */
export const compile = (schema: unknown, options?: CompileOptions): Validator => {
  return compileCached(schema, options, true) as Validator
}
