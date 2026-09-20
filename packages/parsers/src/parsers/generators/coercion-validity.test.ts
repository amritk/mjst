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

  // Each of these left a value the schema rejects exactly where the parser's job
  // is to replace it; all four were reduced from the coerced-output-validity fuzz.
  describe('bounded scalars are repaired inside their bounds', () => {
    it('fills a missing minLength string with one long enough', () => {
      const parse = coerceParser({
        type: 'object',
        properties: { s: { type: 'string', minLength: 2, maxLength: 4 } },
        required: ['s'],
      })
      expect(parse({})).toEqual({ s: 'xx' })
    })

    it('does not hand back a String() conversion that violates the bounds', () => {
      const parse = coerceParser({
        type: 'object',
        properties: { s: { type: 'string', minLength: 1 } },
        required: ['s'],
      })
      // `String({})` is `"[object Object]"`, `String(undefined)` is `"undefined"`
      // — the first clears `minLength` and survives, the second does not apply
      // here; what must never survive is a conversion shorter than the bound.
      expect(parse({ s: '' })).toEqual({ s: 'x' })
    })

    it('moves an out-of-range number inside its bounds', () => {
      const parse = coerceParser({
        type: 'object',
        properties: { n: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['n'],
      })
      expect(parse({ n: -1 })).toEqual({ n: 1 })
      expect(parse({ n: 99 })).toEqual({ n: 1 })
      expect(parse({})).toEqual({ n: 1 })
      expect(parse({ n: 5 })).toEqual({ n: 5 })
    })

    it('respects minItems instead of coercing to an empty array', () => {
      const parse = coerceParser({
        type: 'object',
        properties: { a: { type: 'array', items: { type: 'string' }, minItems: 2 } },
        required: ['a'],
      })
      expect(parse({ a: 'not an array' })).toEqual({ a: ['', ''] })
    })
  })

  describe('every element of an array is repaired', () => {
    it('coerces const items', () => {
      const parse = coerceParser({
        type: 'object',
        properties: { a: { type: 'array', items: { const: null } } },
        required: ['a'],
      })
      expect(parse({ a: ['x', 1] })).toEqual({ a: [null, null] })
    })

    it('coerces items declared with an array-form type', () => {
      const parse = coerceParser({
        type: 'object',
        properties: { a: { type: 'array', items: { type: ['string', 'null'] } } },
        required: ['a'],
      })
      expect(parse({ a: ['keep', null, 1.5] })).toEqual({ a: ['keep', null, ''] })
    })
  })

  describe('union branches match only what they admit', () => {
    // A `const` branch used to reduce to its *inferred type* — `typeof x ===
    // "string"` for `{ const: 'a' }` — so the union reported a match for every
    // string and the parser left an invalid value alone.
    const schema = {
      type: 'object' as const,
      properties: { v: { anyOf: [{ const: 'a' }, { type: 'boolean' as const }] } },
      required: ['v'],
    }

    it('repairs a string that is not the const', () => {
      expect(coerceParser(schema)({ v: 'nope' })).toEqual({ v: 'a' })
    })

    it('keeps a value a branch really admits', () => {
      expect(coerceParser(schema)({ v: 'a' })).toEqual({ v: 'a' })
      expect(coerceParser(schema)({ v: true })).toEqual({ v: true })
    })
  })
})
