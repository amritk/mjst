import { describe, expect, it } from 'vitest'

import { evalGenerated } from './differential.test-utils'
import { generateParserFunction } from './generate-parser-function'

/**
 * Strict mode is documented to *throw* on any schema violation, but a root
 * (non-object) scalar parser historically asserted only the `typeof`, letting
 * `enum` / `const` / `pattern` / length / numeric-range violations pass through.
 * These lock in that a root scalar enforces its full constraint set.
 */
const strictParser = (schema: unknown): ((input: unknown) => unknown) =>
  evalGenerated(generateParserFunction(schema as never, 'Root', { strict: true }), 'parseRoot')

describe('strict root scalar enforces its constraints', () => {
  it('string length and pattern', () => {
    const min = strictParser({ type: 'string', minLength: 5 })
    expect(min('abcde')).toBe('abcde')
    expect(() => min('ab')).toThrow(/at least 5 characters/)

    const pat = strictParser({ type: 'string', pattern: '^[a-z]+$' })
    expect(pat('abc')).toBe('abc')
    expect(() => pat('ABC123')).toThrow(/must match pattern/)
  })

  it('numeric range and multipleOf', () => {
    const min = strictParser({ type: 'number', minimum: 10 })
    expect(min(10)).toBe(10)
    expect(() => min(3)).toThrow(/must be >= 10/)

    const mult = strictParser({ type: 'integer', multipleOf: 5 })
    expect(mult(15)).toBe(15)
    expect(() => mult(7)).toThrow(/multiple of 5/)
  })

  it('typed enum', () => {
    const parse = strictParser({ type: 'string', enum: ['a', 'b'] })
    expect(parse('a')).toBe('a')
    expect(() => parse('zzz')).toThrow(/must be one of/)
  })

  it('type-less enum', () => {
    const parse = strictParser({ enum: ['a', 'b'] })
    expect(parse('b')).toBe('b')
    expect(() => parse('zzz')).toThrow(/must be one of/)
  })

  it('typed const', () => {
    const parse = strictParser({ type: 'string', const: 'only' })
    expect(parse('only')).toBe('only')
    expect(() => parse('other')).toThrow(/must be/)
  })

  it('type-less const', () => {
    const parse = strictParser({ const: 42 })
    expect(parse(42)).toBe(42)
    expect(() => parse(7)).toThrow(/must be/)
  })
})
