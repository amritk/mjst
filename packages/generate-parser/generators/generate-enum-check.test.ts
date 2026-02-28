import { describe, expect, it } from 'vitest'
import { generateEnumCheck } from './generate-enum-check'

describe('generate-enum-check', () => {
  it('generates an includes check for string enum values', () => {
    const result = generateEnumCheck('value', ['a', 'b', 'c'])
    expect(result).toBe('["a","b","c"].includes(value)')
  })

  it('generates an includes check for numeric enum values', () => {
    const result = generateEnumCheck('value', [1, 2, 3])
    expect(result).toBe('[1,2,3].includes(value)')
  })

  it('generates an includes check for mixed type enum values', () => {
    const result = generateEnumCheck('value', ['a', 1, true, null])
    expect(result).toBe('["a",1,true,null].includes(value)')
  })

  it('handles a single enum value', () => {
    const result = generateEnumCheck('value', ['only'])
    expect(result).toBe('["only"].includes(value)')
  })

  it('handles an empty enum array', () => {
    const result = generateEnumCheck('value', [])
    expect(result).toBe('[].includes(value)')
  })

  it('uses the provided accessor in the expression', () => {
    const result = generateEnumCheck('input?.type', ['a', 'b'])
    expect(result).toBe('["a","b"].includes(input?.type)')
  })

  it('handles enum values with special characters', () => {
    const result = generateEnumCheck('value', ['hello world', 'foo"bar'])
    expect(result).toBe('["hello world","foo\\"bar"].includes(value)')
  })

  it('handles boolean enum values', () => {
    const result = generateEnumCheck('value', [true, false])
    expect(result).toBe('[true,false].includes(value)')
  })
})
