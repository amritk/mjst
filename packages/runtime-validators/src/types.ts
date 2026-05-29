/**
 * A single validation error with a human-readable message and a JSON Pointer
 * path indicating where in the document the error occurred.
 *
 * This intentionally mirrors the shape emitted by `@amritk/generate-validators`
 * so code can move between the build-time and runtime validators without churn.
 */
export type ValidationError = {
  message: string
  path: string
}

/**
 * The result of a compiled validator.
 *
 * Returns `true` when the input is valid, or `{ valid: false, errors }` with the
 * list of collected errors when it is not. Returning the boolean literal `true`
 * (rather than `{ valid: true }`) keeps the happy-path check a single `=== true`
 * comparison and avoids allocating a result object for valid input.
 */
export type ValidationResult = true | { valid: false; errors: ValidationError[] }

/**
 * A compiled validator that reports every error it finds.
 *
 * Produced by {@link validate}. Use this when you need to tell the caller *why*
 * their data is invalid (form validation, API error responses, and so on).
 */
export type Validator = (input: unknown) => ValidationResult

/**
 * A compiled boolean type guard.
 *
 * Produced by {@link validateGuard}. This is the fastest path: it short-circuits
 * on the first failure and never allocates an error object, so it is ideal for
 * hot loops where you only care whether the value matches the schema.
 */
export type Guard<T = unknown> = (input: unknown) => input is T

/**
 * Options shared by {@link validate} and {@link validateGuard}.
 */
export type ValidateOptions = {
  /**
   * String formats to enforce (e.g. `email`, `date-time`, `uuid`). Formats are
   * opt-in because, like Ajv, we treat unknown or unlisted formats as
   * annotations rather than hard constraints. Pass `'all'` to enable every
   * built-in format.
   */
  readonly formats?: 'all' | readonly string[]
}
