import { describe, expect, it } from 'vitest'

import { escapeRegexPattern } from './escape-regex-pattern'

describe('escape-regex-pattern', () => {
  it('escapes bare forward slashes so the regex literal does not close early', () => {
    expect(escapeRegexPattern('a/b')).toBe('a\\/b')
    // Input \d{4}/\d{2}/\d{2} → \d{4}\/\d{2}\/\d{2}
    expect(escapeRegexPattern('\\d{4}/\\d{2}/\\d{2}')).toBe('\\d{4}\\/\\d{2}\\/\\d{2}')
  })

  it('leaves backslash escape sequences exactly as-is (does not double them)', () => {
    // \d must stay \d — doubling it would match a literal backslash, not a digit.
    expect(escapeRegexPattern('\\d+')).toBe('\\d+')
    expect(escapeRegexPattern('\\w\\s')).toBe('\\w\\s')
  })

  it('does not double-escape an already-escaped slash', () => {
    // \/ (escaped slash) stays \/, not \\\/.
    expect(escapeRegexPattern('\\/')).toBe('\\/')
  })

  it('leaves regex metacharacters that do not affect the literal untouched', () => {
    expect(escapeRegexPattern('^[a-z]+$')).toBe('^[a-z]+$')
  })

  it('round-trips: the escaped body parses to a regex equivalent to the source pattern', () => {
    for (const pattern of ['\\d{4}/\\d{2}', 'a/b/c', '^https?:\\/\\/', '\\w+@\\w+']) {
      // Build the literal the generator emits and read its source back out.
      const re = new RegExp(escapeRegexPattern(pattern))
      // The RegExp's own source, with \/ normalized back to /, equals the input.
      expect(re.source.replace(/\\\//g, '/')).toBe(pattern.replace(/\\\//g, '/'))
    }
  })
})
