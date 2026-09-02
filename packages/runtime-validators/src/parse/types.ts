import type { ValidateOptions, ValidationError } from '@/types'

/**
 * Phantom carrier for a parser's output type, mirroring the one on `Validator`.
 * It exists only at the type level, so a built {@link Parser} can remember the
 * schema type it came from without changing its call shape.
 */
declare const output: unique symbol

/**
 * The result of running a {@link Parser}.
 *
 * Deliberately *not* the `true | { valid: false }` shape a validator returns.
 * A validator answers a question about the value it was handed; a parser hands
 * back a **different value** than it received, so the success case has to carry
 * that value. Discriminating on `ok` keeps both branches one property check.
 */
export type ParseResult<T = unknown> = { ok: true; value: T } | { ok: false; errors: ValidationError[] }

/**
 * A prepared parser: coerces its input toward the schema, then validates the
 * result. See {@link parse}.
 */
export type Parser<T = unknown> = ((input: unknown) => ParseResult<T>) & {
  readonly [output]?: T
}

/**
 * Options for {@link parse}. Everything {@link ValidateOptions} accepts applies —
 * the validation half of a parse is an ordinary validation — plus the two knobs
 * that decide what the coercion half is allowed to do.
 */
export type ParseOptions = ValidateOptions & {
  /**
   * Convert string inputs to the scalar type their subschema declares
   * (`'42'` → `42`, `'true'` → `true`). Defaults to `true`, which is the whole
   * point of reaching for a parser instead of a validator: HTTP, environment
   * variables, CSV and form encodings all deliver every scalar as a string.
   *
   * Set `false` to keep the value untouched and use this purely as a
   * default-filling pass.
   */
  readonly coerce?: boolean
  /**
   * Fill in an absent object property from the `default` in its subschema.
   * Defaults to `true`.
   *
   * Only *absent* properties are filled — a property explicitly present as
   * `null` is a value the author supplied, not a gap, and JSON Schema's
   * `default` is an annotation about the former.
   */
  readonly defaults?: boolean
}
