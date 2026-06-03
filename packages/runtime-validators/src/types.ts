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
 * Phantom carrier for a validator's inferred output type. It exists only at the
 * type level — there is no runtime property — so a built {@link Validator} can
 * remember the schema type it was created from without changing its call shape.
 */
declare const output: unique symbol

/**
 * A compiled validator that reports every error it finds.
 *
 * Produced by {@link validate}. Use this when you need to tell the caller *why*
 * their data is invalid (form validation, API error responses, and so on).
 *
 * The optional `T` carries the type of data the validator accepts. {@link validate}
 * infers it from the schema, so `Infer<typeof myValidator>` can recover it; the
 * default of `unknown` keeps the bare `Validator` usable wherever the schema type
 * is not needed.
 */
export type Validator<T = unknown> = ((input: unknown) => ValidationResult) & {
  readonly [output]?: T
}

/**
 * A compiled boolean type guard.
 *
 * Produced by {@link validateGuard}. This is the fastest path: it short-circuits
 * on the first failure and never allocates an error object, so it is ideal for
 * hot loops where you only care whether the value matches the schema.
 */
export type Guard<T = unknown> = (input: unknown) => input is T

/**
 * The error `assert` throws when its input fails validation.
 *
 * It is a plain `Error` — so `instanceof Error`, stack traces, and ordinary
 * logging all work — augmented with the structured `errors` array. That lets a
 * caller inspect each failure programmatically (by message and JSON Pointer path)
 * instead of parsing the formatted message string.
 */
export type ValidationFailedError = Error & {
  readonly errors: readonly ValidationError[]
}

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
