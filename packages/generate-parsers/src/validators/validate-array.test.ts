import { describe, expect, it } from 'bun:test'
import { validateArray } from './validate-array'

describe('validate-array', () => {
  it('validates and transforms array items with parser function', () => {
    const parser = (item: unknown) => (typeof item === 'number' ? item * 2 : 0)
    const result = validateArray([1, 2, 3], parser)
    expect(result).toEqual([2, 4, 6])
  })

  it('returns empty array when input is not an array', () => {
    const parser = (item: unknown) => item
    expect(validateArray(null, parser)).toEqual([])
    expect(validateArray(undefined, parser)).toEqual([])
    expect(validateArray('string', parser)).toEqual([])
    expect(validateArray(123, parser)).toEqual([])
    expect(validateArray({}, parser)).toEqual([])
  })

  it('handles empty array input', () => {
    const parser = (item: unknown) => item
    const result = validateArray([], parser)
    expect(result).toEqual([])
  })

  it('applies parser to each item independently', () => {
    const parser = (item: unknown) => {
      if (typeof item === 'string') return item.toUpperCase()
      if (typeof item === 'number') return item.toString()
      return 'unknown'
    }
    const result = validateArray(['hello', 42, true, null], parser)
    expect(result).toEqual(['HELLO', '42', 'unknown', 'unknown'])
  })

  it('propagates parser errors for invalid items', () => {
    // Parser that throws on invalid input
    const strictParser = (item: unknown) => {
      if (typeof item !== 'number') {
        throw new Error(`Expected number, got ${typeof item}`)
      }
      return item * 2
    }

    // Valid array passes through
    expect(validateArray([1, 2, 3], strictParser)).toEqual([2, 4, 6])

    // Invalid item causes parser to throw
    expect(() => validateArray([1, 'invalid', 3], strictParser)).toThrow('Expected number, got string')
  })
})
