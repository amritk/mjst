import { describe, expect, it } from 'vitest'

import { generateDefaultFromPattern } from './generate-default-from-pattern'

/**
 * The contract is one invariant: a returned default matches the pattern it was
 * built from. It is asserted here per-case *and* over a corpus, because the
 * previous implementation was a list of substring heuristics that returned
 * confident, unverified guesses — `'^\\+?\\d{3}\\d{4}$'` was answered with
 * `"+1234567890"` (three digits too many) and `'^http://'` with
 * `"https://example.com"` (wrong scheme). A coercing parser then handed those
 * back as the repair for a missing value, so its output was invalid against the
 * very schema that produced it.
 */
describe('generate-default-from-pattern', () => {
  /** The patterns below, plus every shape the recognized list is meant to serve. */
  const PATTERNS = [
    '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
    '[a-zA-Z0-9].*\\.',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    '^[0-9a-fA-F]{8}',
    '^https?://',
    '^http://',
    '3\\.1\\.\\d+',
    '^\\d+\\.\\d+\\.\\d+$',
    '^\\d{4}-\\d{2}-\\d{2}$',
    '^\\+?\\d{3}\\d{4}$',
    '^\\d{3}\\d{7}$',
    '^[a-z]+$',
    '^[a-z](?:[a-z0-9-]*[a-z0-9])?$',
    '^[A-Z]{2,4}-\\d{3}$',
    '^(cat|dog|bird)$',
    '^v\\d+(\\.\\d+)*$',
    '^#[0-9a-fA-F]{6}$',
    '^[a-z_][a-z0-9_]*$',
    '.*',
    '^$',
  ]

  it.each(PATTERNS)('returns a default that matches %s, or nothing at all', (pattern) => {
    const result = generateDefaultFromPattern(pattern)
    if (result === null) return

    expect(new RegExp(pattern, 'u').test(JSON.parse(result) as string)).toBe(true)
  })

  it.each([
    ['^[a-z]+$', 5, 10],
    ['^[a-z](?:[a-z0-9-]*[a-z0-9])?$', 3, 60],
    ['^[a-z0-9]+$', 8, 8],
    ['^[A-Z]{2,6}$', 4, 6],
  ])('honours the length bounds alongside %s', (pattern, min, max) => {
    const result = generateDefaultFromPattern(pattern, min, max)

    expect(result).not.toBeNull()
    const value = JSON.parse(result as string) as string
    expect(new RegExp(pattern, 'u').test(value)).toBe(true)
    expect(value.length).toBeGreaterThanOrEqual(min)
    expect(value.length).toBeLessThanOrEqual(max)
  })

  it('returns null when the pattern and the length bounds cannot both be satisfied', () => {
    // Four characters exactly, asked to be at least ten long.
    expect(generateDefaultFromPattern('^[a-z]{4}$', 10)).toBeNull()
  })

  it('prefers a recognizable shape when it genuinely matches', () => {
    expect(generateDefaultFromPattern('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')).toBe('"user@example.com"')
    expect(generateDefaultFromPattern('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')).toBe(
      '"00000000-0000-0000-0000-000000000000"',
    )
    expect(generateDefaultFromPattern('^https?://')).toBe('"https://example.com"')
    expect(generateDefaultFromPattern('^\\d{4}-\\d{2}-\\d{2}$')).toBe('"2000-01-01"')
  })

  /**
   * Each of these was previously answered with a value its own pattern rejects.
   * They are kept as named cases rather than folded into the corpus above so a
   * regression names the shape it broke.
   */
  it.each([
    ['^http://', '"http://"'],
    ['3\\.1\\.\\d+', '"3.1.0"'],
    ['^\\+?\\d{3}\\d{4}$', '"0000000"'],
    ['^\\d{3}\\d{7}$', '"0000000000"'],
  ])('no longer answers %s with a value the pattern rejects', (pattern, expected) => {
    expect(generateDefaultFromPattern(pattern)).toBe(expected)
  })

  it.each([
    ['^[a-z]+$', '"a"'],
    ['^\\d+\\.\\d+\\.\\d+$', '"1.0.0"'],
    ['^(cat|dog|bird)$', '"cat"'],
    // Letters are preferred over digits inside a class, so a hex-colour default
    // comes out as `#aaaaaa` rather than `#000000` — both match; identifiers,
    // which dominate real schemas, read better for it.
    ['^#[0-9a-fA-F]{6}$', '"#aaaaaa"'],
    ['^[A-Z]{2,4}-\\d{3}$', '"AA-000"'],
  ])('synthesizes a default for %s, which no fixed list could anticipate', (pattern, expected) => {
    expect(generateDefaultFromPattern(pattern)).toBe(expected)
  })

  it('returns null for an empty pattern', () => {
    expect(generateDefaultFromPattern('')).toBeNull()
  })

  it('returns null rather than guessing at a construct it cannot generate', () => {
    // Lookahead and backreferences describe a language this cannot build a
    // member of; the honest answer is no default.
    expect(generateDefaultFromPattern('^(?=.*[A-Z])[a-z]+$')).toBeNull()
    expect(generateDefaultFromPattern('^(a)\\1$')).toBeNull()
  })

  it('returns null for an uncompilable pattern instead of throwing', () => {
    expect(generateDefaultFromPattern('^[a-')).toBeNull()
  })
})
