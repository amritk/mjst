import { prepareValidator } from '@/interpreter/prepare'

import type { FromSchema } from './from-schema'
import type { Asserter, ValidateOptions, ValidationError, ValidationFailedError, Validator } from './types'

/**
 * Renders the collected errors into one readable message for the thrown Error.
 * Each line carries its JSON Pointer path (root errors show as `<root>`, since an
 * empty path is easy to miss) followed by the message, so a stack trace or a log
 * line tells you what failed and where without unpacking the `errors` array.
 */
const formatMessage = (errors: readonly ValidationError[]): string => {
  const lines = errors.map(({ path, message }) => `  - ${path === '' ? '<root>' : path}: ${message}`)
  return `Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:\n${lines.join('\n')}`
}

/**
 * Builds the validation error without a class — we keep to the package's
 * functional style by augmenting a plain `Error` rather than subclassing it, so
 * `instanceof Error` and normal logging keep working while callers can still read
 * the structured `errors` off it.
 */
const validationFailedError = (errors: ValidationError[]): ValidationFailedError => {
  const error = new Error(formatMessage(errors))
  error.name = 'ValidationFailedError'
  return Object.assign(error, { errors })
}

/**
 * Builds an asserting parser for a JSON Schema: a function that returns its input
 * typed to the schema when valid, and throws when not.
 *
 * This is the "valid or bust" counterpart to {@link validate}. Where `validate`
 * hands back a result you branch on, `assert` returns the data directly — typed
 * to the schema — so it slots into a pipeline as a parse step, and a failure is a
 * thrown {@link ValidationFailedError} rather than a value to inspect. The thrown
 * error carries every collected error (each with a message and JSON Pointer path)
 * on its `errors` property, so a caller can still report exactly what went wrong.
 *
 * Like the others, it interprets the schema directly (no `new Function`, no build
 * step) and shares the same per-schema validator cache, so repeated calls reuse
 * the warm regex and `$ref` caches.
 *
 * The `const` type parameter infers the schema as a literal, so the returned
 * {@link Asserter} is typed to the data it accepts — no `as const` needed at the
 * call site. Recover the type with `ReturnType<typeof asserter>`.
 *
 * @example
 * ```typescript
 * const parseUser = assert({
 *   type: 'object',
 *   properties: { id: { type: 'integer' }, name: { type: 'string' } },
 *   required: ['id', 'name'],
 * })
 *
 * const user = parseUser(input) // typed { id: number; name: string }, or throws
 *
 * try {
 *   parseUser({ id: 'nope' })
 * } catch (error) {
 *   if (error instanceof Error && 'errors' in error) {
 *     error.errors // [{ message: 'must be integer', path: '/id' }, ...]
 *   }
 * }
 * ```
 */
export const assert = <const S = unknown>(schema: S, options?: ValidateOptions): Asserter<FromSchema<S>> => {
  const validator = prepareValidator(schema, options, true) as Validator<FromSchema<S>>
  return (input: unknown): FromSchema<S> => {
    const result = validator(input)
    if (result === true) return input as FromSchema<S>
    throw validationFailedError(result.errors)
  }
}
