import type { RulesetFunction } from '@amritk/lint-core'

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

/** Flags a value whose size falls outside the `min`/`max` bounds. */
export const length: RulesetFunction<unknown, { min?: number; max?: number }> = (input, options) => {
  const size = measure(input)
  if (size === undefined) return []
  const results = []
  if (options?.min !== undefined && size < options.min) {
    results.push({ message: `The value must not be shorter than ${options.min}` })
  }
  if (options?.max !== undefined && size > options.max) {
    results.push({ message: `The value must not be longer than ${options.max}` })
  }
  return results
}
