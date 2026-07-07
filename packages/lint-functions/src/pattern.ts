import type { RulesetFunction } from '@amritk/lint-core'

/** Parses a `/pattern/flags` string (or a bare pattern) into a RegExp. */
const toRegExp = (pattern: string): RegExp => {
  const match = /^\/(.+)\/([a-z]*)$/s.exec(pattern)
  if (match) return new RegExp(match[1] as string, match[2])
  return new RegExp(pattern)
}

/** Flags a string that fails `match` or satisfies `notMatch`. */
export const pattern: RulesetFunction<string, { match?: string; notMatch?: string }> = (input, options) => {
  if (typeof input !== 'string') return []
  const results = []
  if (options?.match !== undefined && !toRegExp(options.match).test(input)) {
    results.push({ message: `The value must match the pattern "${options.match}"` })
  }
  if (options?.notMatch !== undefined && toRegExp(options.notMatch).test(input)) {
    results.push({ message: `The value must not match the pattern "${options.notMatch}"` })
  }
  return results
}
