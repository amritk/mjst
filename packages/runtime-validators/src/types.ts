import type { ValidateLimits } from './interpreter/limits'

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
 * A boolean check that deliberately does *not* narrow.
 *
 * {@link validateGuard} returns this instead of a {@link Guard} for the one family
 * of schemas where narrowing would be a lie: a schema with no `type` (or `enum` /
 * `const` / `$ref`) that carries object- or array-shaped keywords, such as
 * `{ properties: { a: { type: 'string' } } }`. JSON Schema reads that as "**if**
 * the instance is an object, its `a` is a string", so `42` passes — while the
 * inferred type describes only the object case. The verdict is right either way;
 * it is the `input is T` claim that would be wrong, so it is dropped.
 *
 * It still carries the inferred type as a phantom, so `Infer<typeof check>` names
 * the shape the schema describes. Add `type: 'object'` to the schema and you get
 * a narrowing {@link Guard} back — which is what you wanted if you expected one.
 */
export type Check<T = unknown> = ((input: unknown) => boolean) & {
  readonly [output]?: T
}

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
  /**
   * Resource ceilings that keep a validation from being turned into a
   * denial-of-service by an adversarial schema or input — recursion depth, total
   * work, and unsafe regex patterns. The defaults are generous enough that
   * ordinary schemas and documents never trip them; see {@link ValidateLimits}.
   * Exceeding a runtime ceiling throws a `ValidationLimitError`
   * ({@link isValidationLimitError}).
   */
  readonly limits?: ValidateLimits
  /**
   * Other schema documents you have **already loaded**, keyed by the absolute
   * URI a `$ref` names them by. Supplying them makes those URIs resolvable, so a
   * schema can reference a document that is not the one being validated.
   *
   * This package still never fetches and never reads a file — it cannot be told
   * a URL, only a document — so `validate` stays a pure, synchronous function of
   * its inputs. Loading is yours to do (or `@amritk/resolve-refs`'), and however
   * you do it, the result comes back through here.
   *
   * Each registered document is a schema resource like any other: its own `$id`,
   * `$anchor`s, `$dynamicAnchor`s and nested embedded resources all become
   * resolvable, a `$ref` from one registered document into another resolves, and
   * `$dynamicRef` bookending works across documents. A document with no `$id`
   * resolves its relative `$ref`s against the URI you registered it under, and
   * one whose `$id` disagrees with that URI answers to both.
   *
   * Treat the map and the documents in it as immutable once passed. Validators
   * are cached per `(schema, options)`, and the registry takes part in that key
   * by identity — hand over a *new* object when the set of documents changes,
   * rather than mutating one you already passed.
   *
   * @example
   * ```typescript
   * const validator = validate(
   *   { $ref: 'https://example.com/user.json' },
   *   { schemas: { 'https://example.com/user.json': userSchema } },
   * )
   * ```
   */
  readonly schemas?: Readonly<Record<string, unknown>>
}

export type { ValidateLimits }
