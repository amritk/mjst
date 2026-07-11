import type { RulesetFunction } from '../core'

/** Options for {@link pattern}. */
export type IPatternOptions = {
  match?: string
  notMatch?: string
}

// Compiling a RegExp is not free, and rules run this function once per matched
// node, so we memoize by the raw pattern string (which carries its own flags in
// the `/re/flags` form). A failed compile is cached as its `Error` so a bad
// pattern is reported without being re-thrown on every node. Mirrors Spectral's
// own module-level cache.
const cache = new Map<string, RegExp | Error>()

/** Parses a `/pattern/flags` string (or a bare pattern) into a RegExp, or the compile error. */
const toRegExp = (pattern: string): RegExp | Error => {
  const cached = cache.get(pattern)
  if (cached !== undefined) {
    // A cached RegExp carrying the `g`/`y` flag keeps `lastIndex` between calls,
    // which would make `.test` skip characters on the next node. Reset it so a
    // reused pattern behaves the same as a freshly compiled one.
    if (cached instanceof RegExp) cached.lastIndex = 0
    return cached
  }
  let compiled: RegExp | Error
  try {
    const match = /^\/(.+)\/([a-z]*)$/s.exec(pattern)
    compiled = match ? new RegExp(match[1] as string, match[2]) : new RegExp(pattern)
  } catch (error) {
    compiled = error instanceof Error ? error : new Error(String(error))
  }
  cache.set(pattern, compiled)
  return compiled
}

/** Flags a string that fails `match` or satisfies `notMatch`. */
export const pattern: RulesetFunction<string, IPatternOptions> = (input, options) => {
  if (typeof input !== 'string') return []
  const results = []
  if (options?.match !== undefined) {
    const re = toRegExp(options.match)
    if (re instanceof Error) {
      results.push({ message: `The "match" option is not a valid regular expression: ${re.message}` })
    } else if (!re.test(input)) {
      results.push({ message: `The value must match the pattern "${options.match}"` })
    }
  }
  if (options?.notMatch !== undefined) {
    const re = toRegExp(options.notMatch)
    if (re instanceof Error) {
      results.push({ message: `The "notMatch" option is not a valid regular expression: ${re.message}` })
    } else if (re.test(input)) {
      results.push({ message: `The value must not match the pattern "${options.notMatch}"` })
    }
  }
  return results
}
