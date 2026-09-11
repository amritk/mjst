import type { SchemaIssue } from './interpreter/check-schema'
import type { FormatDefinition } from './interpreter/formats'
import type { ValidateLimits } from './interpreter/limits'

/**
 * A single validation error with a human-readable message and a JSON Pointer
 * path indicating where in the document the error occurred.
 *
 * This intentionally mirrors the shape emitted by `@amritk/generate-validators`
 * so code can move between the build-time and runtime validators without churn.
 */
export type ValidationError = {
  /** Human-readable description of what went wrong. */
  message: string
  /** JSON Pointer to the offending value inside the instance. */
  path: string
  /**
   * The JSON Schema keyword that rejected the value — `type`, `required`,
   * `minimum`, and so on.
   *
   * This is what makes an error *programmable* rather than only printable. A
   * caller can branch on it (is this a missing field or a malformed one?), group
   * by it, or use it with {@link params} to render a message of their own — a
   * translated one, or one written in the language of their domain rather than
   * of JSON Schema.
   */
  keyword: string
  /**
   * The keyword's own values, as far as they explain the failure: the bound that
   * was exceeded, the property that was missing, the allowed values that were
   * not matched. Empty for a keyword with nothing to add beyond its name.
   *
   * The shape depends on the keyword and is documented alongside each in the
   * README. It exists so a caller can rebuild the message: `params.limit` with
   * `keyword: 'maxLength'` is everything "must have at most 20 characters" says,
   * without being in English.
   */
  params: Readonly<Record<string, unknown>>
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
   * Format checkers of your own, keyed by the name a schema's `format` would
   * use. A `RegExp` or a predicate describes a **string** format; the object
   * form (`{ type: 'number', validate }`) describes one over numbers.
   *
   * Registering a format is the opt-in, so unlike the built-ins these are always
   * checked and do not additionally have to be named in {@link formats}. A
   * definition here also *replaces* a built-in of the same name, which is how to
   * tighten `email` or loosen `uri` without forking the package.
   *
   * Nothing screens a `RegExp` you supply for catastrophic backtracking the way
   * a schema's own `pattern` is screened — you wrote it, so it is trusted the
   * same way the rest of your code is.
   *
   * Treat the map as immutable once passed: like {@link schemas}, it takes part
   * in the validator cache key by identity and by the names it defines.
   *
   * @example
   * ```typescript
   * validate(schema, {
   *   customFormats: {
   *     'phone-e164': /^\+[1-9]\d{6,14}$/,
   *     port: { type: 'number', validate: (value) => Number.isInteger(value) && value > 0 && value < 65_536 },
   *   },
   * })
   * ```
   */
  readonly customFormats?: Readonly<Record<string, FormatDefinition>>
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
  /**
   * Refuse to build a validator for a schema that does not say what its author
   * meant — a keyword carrying the wrong kind of value, one nobody recognizes, a
   * value that makes its keyword meaningless, or a constraint the node's own
   * `type` has already ruled out.
   *
   * Off by default, because the permissive reading is the specification's: an
   * unknown keyword is an annotation and a wrong-typed one is not an assertion.
   * Both are also silent, which is why this exists — `{ required: 'name' }` and
   * `{ maxlength: 5 }` enforce nothing, and nothing says so.
   *
   * Turn it on wherever the schema is yours to fix (a build step, a test, a
   * config loaded at startup). Leave it off for a schema that arrives from
   * somewhere you do not control, where an unknown keyword is somebody else's
   * extension rather than your typo — and reach for {@link checkSchema} there
   * instead, which reports the same findings without refusing.
   *
   * Building throws a `SchemaError` listing every issue found; use
   * {@link isSchemaError} to tell it from an ordinary throw.
   */
  readonly strict?: boolean
}

export type { FormatDefinition, SchemaIssue, ValidateLimits }
