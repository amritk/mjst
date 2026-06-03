import { prepareValidator } from '@/interpreter/prepare'

import type { FromSchema } from './from-schema'
import type { ValidateOptions, ValidationError, ValidationFailedError, ValidationResult } from './types'

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
 * Validates `value` against a JSON Schema and returns it typed to the schema, or
 * throws when it does not match.
 *
 * This is the one-shot, "valid or bust" counterpart to {@link validate}. Where
 * `validate` builds a reusable validator you call later and branch on, `assert`
 * does it all in a single call: pass the schema and the value, get the typed data
 * back, and on failure get a thrown {@link ValidationFailedError} instead of a
 * result to inspect. That error carries every collected error (each with a message
 * and JSON Pointer path) on its `errors` property, so a caller can still report
 * exactly what went wrong.
 *
 * It interprets the schema directly (no `new Function`, no build step) and shares
 * the same per-schema validator cache as {@link validate}, so passing the same
 * schema object repeatedly reuses the warm regex and `$ref` caches.
 *
 * The `const` type parameter infers the schema as a literal, so the returned value
 * is typed to the data the schema accepts — no `as const` needed at the call site.
 *
 * @example
 * ```typescript
 * const user = assert(
 *   {
 *     type: 'object',
 *     properties: { id: { type: 'integer' }, name: { type: 'string' } },
 *     required: ['id', 'name'],
 *   },
 *   input,
 * )
 * //    ^? { id: number; name: string }   — or throws ValidationFailedError
 *
 * try {
 *   assert({ type: 'integer' }, 3.5)
 * } catch (error) {
 *   if (error instanceof Error && 'errors' in error) {
 *     error.errors // [{ message: 'must be integer', path: '' }]
 *   }
 * }
 * ```
 */
export const assert = <const S = unknown>(schema: S, value: unknown, options?: ValidateOptions): FromSchema<S> => {
  const validator = prepareValidator(schema, options, true) as (input: unknown) => ValidationResult
  const result = validator(value)
  if (result === true) return value as FromSchema<S>
  throw validationFailedError(result.errors)
}
