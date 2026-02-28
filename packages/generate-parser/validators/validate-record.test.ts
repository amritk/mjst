import { describe, expect, it } from 'vitest'
import { validateRecord } from './validate-record'

describe('validate-record', () => {
  it('validates all values in a record using the parser function', () => {
    const input = { a: '1', b: '2', c: '3' }
    const parser = (value: unknown) => Number(value)
    const result = validateRecord(input, parser)
    
    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('returns empty object when input is not a plain object', () => {
    const parser = (value: unknown) => value
    
    expect(validateRecord(null, parser)).toEqual({})
    expect(validateRecord(undefined, parser)).toEqual({})
    expect(validateRecord(123, parser)).toEqual({})
    expect(validateRecord('string', parser)).toEqual({})
    expect(validateRecord([], parser)).toEqual({})
    expect(validateRecord(new Date(), parser)).toEqual({})
  })

  it('handles empty objects correctly', () => {
    const parser = (value: unknown) => value
    const result = validateRecord({}, parser)
    
    expect(result).toEqual({})
  })

  it('preserves keys and applies parser to nested objects as values', () => {
    const input = { user: { name: 'John' }, count: { value: 42 } }
    const parser = (value: unknown) => JSON.stringify(value)
    const result = validateRecord(input, parser)
    
    expect(result).toEqual({
      user: '{"name":"John"}',
      count: '{"value":42}'
    })
  })

  it('applies parser to all values including null and undefined', () => {
    const input = { a: null, b: undefined, c: 0, d: false, e: '' }
    const parser = (value: unknown) => value === null || value === undefined ? 'missing' : value
    const result = validateRecord(input, parser)
    
    expect(result).toEqual({
      a: 'missing',
      b: 'missing',
      c: 0,
      d: false,
      e: ''
    })
  })
})
