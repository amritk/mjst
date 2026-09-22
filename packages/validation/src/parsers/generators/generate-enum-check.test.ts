import { describe, expect, it } from 'vitest'

import { generateEnumCaseInsensitiveCoercion, generateEnumCheck } from './generate-enum-check'

describe('generate-enum-check', () => {
  it('generates an === chain for string enum values', () => {
    const result = generateEnumCheck('value', ['a', 'b', 'c'])
    expect(result).toBe('(value === "a" || value === "b" || value === "c")')
  })

  it('generates an === chain for numeric enum values', () => {
    const result = generateEnumCheck('value', [1, 2, 3])
    expect(result).toBe('(value === 1 || value === 2 || value === 3)')
  })

  it('generates an === chain for mixed primitive enum values', () => {
    const result = generateEnumCheck('value', ['a', 1, true, null])
    expect(result).toBe('(value === "a" || value === 1 || value === true || value === null)')
  })

  it('handles a single enum value', () => {
    const result = generateEnumCheck('value', ['only'])
    expect(result).toBe('(value === "only")')
  })

  it('handles an empty enum array', () => {
    // No members means nothing can ever match, and an empty `===` chain would
    // not even parse — so the check collapses to the constant.
    const result = generateEnumCheck('value', [])
    expect(result).toBe('false')
  })

  it('uses the provided accessor in the expression', () => {
    const result = generateEnumCheck('input?.type', ['a', 'b'])
    expect(result).toBe('(input?.type === "a" || input?.type === "b")')
  })

  it('handles enum values with special characters', () => {
    const result = generateEnumCheck('value', ['hello world', 'foo"bar'])
    expect(result).toBe('(value === "hello world" || value === "foo\\"bar")')
  })

  it('handles boolean enum values', () => {
    const result = generateEnumCheck('value', [true, false])
    expect(result).toBe('(value === true || value === false)')
  })

  // `.includes` is SameValueZero, so an object member could only ever match by
  // reference — i.e. never, for a freshly parsed document. Structural equality
  // against the known literal is the only comparison that can succeed.
  it('compares an object member structurally rather than by reference', () => {
    const result = generateEnumCheck('value', [{ a: 1 }, 'x'])
    expect(result).toBe(
      '((typeof value === "object" && value !== null && !Array.isArray(value)' +
        ' && Object.keys(value as object).length === 1' +
        ' && (value as Record<string, unknown>).a === 1) || value === "x")',
    )
  })

  it('compares an array member element-wise, including its length', () => {
    const result = generateEnumCheck('value', [['a', 'b']])
    expect(result).toBe(
      '((Array.isArray(value) && (value as unknown[]).length === 2' +
        ' && (value as unknown[])[0] === "a" && (value as unknown[])[1] === "b"))',
    )
  })

  it('keeps a NaN member on Number.isNaN, the one case === cannot express', () => {
    expect(generateEnumCheck('value', [Number.NaN, 1])).toBe('(Number.isNaN(value) || value === 1)')
  })
})

describe('generateEnumCaseInsensitiveCoercion', () => {
  it('maps each string member by its lowercased form to its exact casing', () => {
    const result = generateEnumCaseInsensitiveCoercion('value', ['Hello', 'World'], '"Hello"')
    expect(result).toBe(
      '(typeof value === "string" ? (new Map([["hello","Hello"],["world","World"]]).get((value as string).toLowerCase()) ?? "Hello") : "Hello")',
    )
  })

  it('guards on typeof string and falls back for non-string input', () => {
    const result = generateEnumCaseInsensitiveCoercion('value', ['a'], 'undefined')
    expect(result).toContain('typeof value === "string"')
    expect(result).toContain('(value as string).toLowerCase()')
    expect(result?.endsWith(': undefined)')).toBe(true)
  })

  it('ignores non-string members (no case to fold)', () => {
    const result = generateEnumCaseInsensitiveCoercion('value', ['On', 1, true, null], '1')
    expect(result).toContain('new Map([["on","On"]])')
  })

  it('lets declaration order win when two members fold to the same key', () => {
    const result = generateEnumCaseInsensitiveCoercion('value', ['on', 'ON'], '"on"')
    // First writer wins: the map key `on` resolves to the first member's casing.
    expect(result).toContain('new Map([["on","on"]])')
  })

  it('returns null when no member is a string', () => {
    expect(generateEnumCaseInsensitiveCoercion('value', [1, 2, true], '1')).toBeNull()
    expect(generateEnumCaseInsensitiveCoercion('value', [], '""')).toBeNull()
  })

  it('uses the provided accessor', () => {
    const result = generateEnumCaseInsensitiveCoercion('input?.status', ['Active'], '"Active"')
    expect(result).toContain('(input?.status as string).toLowerCase()')
  })
})
