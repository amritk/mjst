import { describe, expect, it } from 'bun:test'
import { generateDefaultFromPattern } from '#parser/generators/generate-default-from-pattern'

describe('generate-default-from-pattern', () => {
  it('returns email default for pattern containing @', () => {
    const result = generateDefaultFromPattern('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')
    expect(result).toBe('"user@example.com"')
  })

  it('returns email default for pattern with character class and dot', () => {
    const result = generateDefaultFromPattern('[a-zA-Z0-9].*\\.')
    expect(result).toBe('"user@example.com"')
  })

  it('returns UUID default for hex pattern with {8}', () => {
    const result = generateDefaultFromPattern('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    expect(result).toBe('"00000000-0000-0000-0000-000000000000"')
  })

  it('returns UUID default for pattern with dash separator', () => {
    const result = generateDefaultFromPattern('[0-9a-f]{8}\\-[0-9a-f]{4}')
    expect(result).toBe('"00000000-0000-0000-0000-000000000000"')
  })

  it('returns null for hex pattern without dash or matching structure', () => {
    const result = generateDefaultFromPattern('^[0-9a-fA-F]{8}')
    expect(result).toBeNull()
  })

  it('returns URL default for https? pattern', () => {
    const result = generateDefaultFromPattern('^https?://')
    expect(result).toBe('"https://example.com"')
  })

  it('returns URL default for http pattern', () => {
    const result = generateDefaultFromPattern('^http://')
    expect(result).toBe('"https://example.com"')
  })

  it('returns semver default for version-like pattern with literal digits', () => {
    // The regex looks for actual digit chars and escaped dots in the pattern string
    const result = generateDefaultFromPattern('3\\.1\\.\\d+')
    expect(result).toBe('"1.0.0"')
  })

  it('returns null for version pattern without literal digits', () => {
    const result = generateDefaultFromPattern('^\\d+\\.\\d+\\.\\d+$')
    expect(result).toBeNull()
  })

  it('returns ISO date default for date-like pattern', () => {
    const result = generateDefaultFromPattern('^\\d{4}-\\d{2}-\\d{2}$')
    expect(result).toBe('"2000-01-01"')
  })

  it('returns phone number default for phone-like pattern with {3} and {4}', () => {
    const result = generateDefaultFromPattern('^\\+?\\d{3}\\d{4}$')
    expect(result).toBe('"+1234567890"')
  })

  it('returns phone number default for phone-like pattern with {3} and {7}', () => {
    const result = generateDefaultFromPattern('^\\d{3}\\d{7}$')
    expect(result).toBe('"+1234567890"')
  })

  it('returns null for unrecognized pattern', () => {
    const result = generateDefaultFromPattern('^[a-z]+$')
    expect(result).toBeNull()
  })

  it('returns null for empty pattern', () => {
    const result = generateDefaultFromPattern('')
    expect(result).toBeNull()
  })

  it('returns null for simple wildcard pattern', () => {
    const result = generateDefaultFromPattern('.*')
    expect(result).toBeNull()
  })
})
