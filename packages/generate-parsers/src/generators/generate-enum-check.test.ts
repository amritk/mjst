import { describe, expect, it } from 'vitest'

import { generateEnumCheck } from './generate-enum-check'

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
    // With no members the === chain would be empty, so fall back to .includes.
    const result = generateEnumCheck('value', [])
    expect(result).toBe('[].includes(value as never)')
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

  it('falls back to .includes when a member is an object (reference equality)', () => {
    const result = generateEnumCheck('value', [{ a: 1 }, 'x'])
    expect(result).toBe('[{"a":1},"x"].includes(value as never)')
  })
})
