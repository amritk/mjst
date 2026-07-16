import { describe, expect, it } from 'vitest'

import { evalGenerated } from './differential.test-utils'
import { generateParserFunction } from './generate-parser-function'

/**
 * The coercing (non-strict) parser is documented to *repair* invalid input into a
 * valid instance. These cases pin down repairs that previously produced values
 * still invalid against the schema: a non-integral number left on an `integer`
 * field, and an array-form `type` (`["string","null"]`) coerced to `undefined`.
 */
const coerceParser = (schema: unknown): ((input: unknown) => unknown) =>
  evalGenerated(generateParserFunction(schema as never, 'Root', { strict: false }), 'parseRoot')

describe('coercion produces a valid instance', () => {
  describe('integer fields coerce to whole numbers', () => {
    const schema = {
      type: 'object' as const,
      properties: { n: { type: 'integer' as const } },
      required: ['n'],
    }

    it('repairs a non-integral number to the default rather than leaving 1.5', () => {
      const parse = coerceParser(schema)
      expect(parse({ n: 1.5 })).toEqual({ n: 0 })
      expect(parse({ n: '2.5' })).toEqual({ n: 0 })
    })

    it('keeps and coerces genuine integers', () => {
      const parse = coerceParser(schema)
      expect(parse({ n: 2 })).toEqual({ n: 2 })
      expect(parse({ n: '3' })).toEqual({ n: 3 })
      expect(parse({ n: 4.0 })).toEqual({ n: 4 })
    })
  })

  describe('array-form type (["string","null"]) coerces to a valid member', () => {
    const schema = {
      type: 'object' as const,
      properties: { a: { type: ['string', 'null'] as const } },
      required: ['a'],
    }

    it('fills a missing required value with a valid member, not undefined', () => {
      const parse = coerceParser(schema)
      expect(parse({})).toEqual({ a: '' })
    })

    it('coerces a wrong-typed value to a valid member', () => {
      const parse = coerceParser(schema)
      expect(parse({ a: 42 })).toEqual({ a: '' })
    })

    it('leaves values that already match a listed type', () => {
      const parse = coerceParser(schema)
      expect(parse({ a: 'x' })).toEqual({ a: 'x' })
      expect(parse({ a: null })).toEqual({ a: null })
    })
  })
})
