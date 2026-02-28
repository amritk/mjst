import { describe, expect, it } from 'vitest'
import { safeAccessor, safeKey } from './safe-accessor'

describe('safe-accessor', () => {
  it('uses dot notation for simple identifiers', () => {
    expect(safeAccessor('input', 'name')).toBe('input.name')
  })

  it('uses bracket notation for hyphenated keys', () => {
    expect(safeAccessor('input', 'x-linkedin')).toBe("input['x-linkedin']")
  })

  it('uses optional chaining with bracket notation for hyphenated keys', () => {
    expect(safeAccessor('input?', 'x-linkedin')).toBe("input?.['x-linkedin']")
  })

  it('uses dot notation for underscored identifiers', () => {
    expect(safeAccessor('input', '_private')).toBe('input._private')
  })

  it('uses bracket notation for keys starting with numbers', () => {
    expect(safeAccessor('input', '0foo')).toBe("input['0foo']")
  })

  it('uses bracket notation for keys with dots', () => {
    expect(safeAccessor('input', 'foo.bar')).toBe("input['foo.bar']")
  })

  it('returns unquoted key for simple identifiers', () => {
    expect(safeKey('name')).toBe('name')
  })

  it('returns quoted key for hyphenated names', () => {
    expect(safeKey('x-linkedin')).toBe("'x-linkedin'")
  })

  it('returns quoted key for names with dots', () => {
    expect(safeKey('foo.bar')).toBe("'foo.bar'")
  })
})
