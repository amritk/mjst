import { describe, expect, it } from 'vitest'
import { getDefaultValue } from './get-default-value'

describe('get-default-value', () => {
  it('returns undefined for boolean schema', () => {
    expect(getDefaultValue(true)).toBe('undefined')
    expect(getDefaultValue(false)).toBe('undefined')
  })

  it('returns explicit default value when present', () => {
    expect(getDefaultValue({ default: 'hello' })).toBe('"hello"')
  })

  it('returns explicit default for numeric value', () => {
    expect(getDefaultValue({ default: 42 })).toBe('42')
  })

  it('returns explicit default for boolean value', () => {
    expect(getDefaultValue({ default: true })).toBe('true')
  })

  it('returns explicit default for null', () => {
    expect(getDefaultValue({ default: null })).toBe('null')
  })

  it('returns explicit default for object value', () => {
    expect(getDefaultValue({ default: { key: 'value' } })).toBe('{"key":"value"}')
  })

  it('returns first enum value when no default', () => {
    expect(getDefaultValue({ enum: ['a', 'b', 'c'] })).toBe('"a"')
  })

  it('returns first example value when no default or enum', () => {
    expect(getDefaultValue({ examples: ['example1', 'example2'] })).toBe('"example1"')
  })

  it('returns default from first oneOf schema', () => {
    const schema = {
      oneOf: [
        { type: 'string' as const, default: 'from-oneof' },
        { type: 'number' as const },
      ],
    }
    expect(getDefaultValue(schema)).toBe('"from-oneof"')
  })

  it('recurses into oneOf when first schema has no explicit default', () => {
    const schema = {
      oneOf: [
        { type: 'string' as const },
        { type: 'number' as const },
      ],
    }
    expect(getDefaultValue(schema)).toBe('""')
  })

  it('returns default from first anyOf schema', () => {
    const schema = {
      anyOf: [
        { type: 'number' as const },
      ],
    }
    expect(getDefaultValue(schema)).toBe('0')
  })

  it('returns default from first allOf schema', () => {
    const schema = {
      allOf: [
        { type: 'boolean' as const },
      ],
    }
    expect(getDefaultValue(schema)).toBe('false')
  })

  it('returns undefined when no type is specified', () => {
    expect(getDefaultValue({ description: 'no type' })).toBe('undefined')
  })

  it('returns empty string for string type', () => {
    expect(getDefaultValue({ type: 'string' })).toBe('""')
  })

  it('returns 0 for number type', () => {
    expect(getDefaultValue({ type: 'number' })).toBe('0')
  })

  it('returns 0 for integer type', () => {
    expect(getDefaultValue({ type: 'integer' })).toBe('0')
  })

  it('returns false for boolean type', () => {
    expect(getDefaultValue({ type: 'boolean' })).toBe('false')
  })

  it('returns empty array for array type', () => {
    expect(getDefaultValue({ type: 'array' })).toBe('[]')
  })

  it('returns empty object for object type', () => {
    expect(getDefaultValue({ type: 'object' })).toBe('{}')
  })

  it('returns undefined for unknown type', () => {
    expect(getDefaultValue({ type: 'null' })).toBe('undefined')
  })

  it('uses pattern-based default for string with email pattern', () => {
    const schema = { type: 'string' as const, pattern: '^[a-z]+@[a-z]+\\.[a-z]+$' }
    expect(getDefaultValue(schema)).toBe('"user@example.com"')
  })

  it('falls back to empty string when pattern is not recognized', () => {
    const schema = { type: 'string' as const, pattern: '^[a-z]+$' }
    expect(getDefaultValue(schema)).toBe('""')
  })

  it('prioritizes default over enum', () => {
    const schema = { default: 'explicit', enum: ['a', 'b'] }
    expect(getDefaultValue(schema)).toBe('"explicit"')
  })

  it('prioritizes enum over examples', () => {
    const schema = { enum: ['enumVal'], examples: ['exampleVal'] }
    expect(getDefaultValue(schema)).toBe('"enumVal"')
  })

  it('prioritizes examples over type-based default', () => {
    const schema = { type: 'string' as const, examples: ['myExample'] }
    expect(getDefaultValue(schema)).toBe('"myExample"')
  })

  it('handles empty enum array and falls back', () => {
    expect(getDefaultValue({ enum: [], type: 'string' })).toBe('""')
  })

  it('handles empty examples array and falls back', () => {
    expect(getDefaultValue({ examples: [], type: 'number' })).toBe('0')
  })

  it('handles empty oneOf array and falls back', () => {
    expect(getDefaultValue({ oneOf: [], type: 'boolean' })).toBe('false')
  })
})
