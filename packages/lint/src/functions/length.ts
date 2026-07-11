import type { RulesetFunction } from '../core'

/** Options for {@link length}. */
export type ILengthOptions = {
  min?: number
  max?: number
}

/**
 * Returns the comparable size of a value: string/array length, object key count,
 * or the number itself. `undefined` for anything else (so the rule is skipped).
 */
const measure = (input: unknown): number | undefined => {
  if (typeof input === 'string' || Array.isArray(input)) return input.length
  if (typeof input === 'object' && input !== null) return Object.keys(input).length
  if (typeof input === 'number') return input
  return undefined
}

/**
 * Flags a value whose size falls outside the `min`/`max` bounds.
 *
 * With neither `min` nor `max` supplied this is a no-op on every node. That
 * matches Spectral, which requires at least one bound in its option schema and
 * simply produces no results once the options load without them. We also ignore
 * a `min`/`max` that is not a number so a stray string like "3" cannot slip into
 * the `<`/`>` comparison and be coerced into a misleading result.
 */
export const length: RulesetFunction<unknown, ILengthOptions> = (input, options) => {
  const size = measure(input)
  if (size === undefined) return []
  const results = []
  if (typeof options?.min === 'number' && size < options.min) {
    results.push({ message: `The value must not be shorter than ${options.min}` })
  }
  if (typeof options?.max === 'number' && size > options.max) {
    results.push({ message: `The value must not be longer than ${options.max}` })
  }
  return results
}
