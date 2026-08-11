import { describe, expect, it } from 'vitest'

import { enforceTupleLength, normalizeDraftTuples } from './normalize-tuples'

describe('normalize-tuples', () => {
  it('rewrites a draft-07 tuple into prefixItems', () => {
    const schema = { type: 'array', items: [{ type: 'string' }, { type: 'number' }] }
    normalizeDraftTuples(schema)
    expect(schema).toEqual({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] })
  })

  it('turns additionalItems into the rest element', () => {
    const schema = { type: 'array', items: [{ type: 'string' }], additionalItems: { type: 'number' } }
    normalizeDraftTuples(schema)
    expect(schema).toEqual({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } })
  })

  it('bounds a bare prefixItems tuple', () => {
    const schema = { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] }
    enforceTupleLength(schema)
    expect(schema).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false,
    })
  })

  describe('keywords whose values are data, not schemas', () => {
    // A `default` / `const` / `enum` / `examples` value is a value the schema
    // describes. An object under one that happens to have an `items` array is
    // that value's own property — rewriting it hands the consumer a different
    // value than the author wrote, with nothing to say it changed.
    for (const keyword of ['default', 'const'] as const) {
      it(`leaves an items array inside ${keyword} alone`, () => {
        const schema = { type: 'object', [keyword]: { items: ['a', 'b'] } }
        normalizeDraftTuples(schema)
        enforceTupleLength(schema)
        expect(schema).toEqual({ type: 'object', [keyword]: { items: ['a', 'b'] } })
      })
    }

    it('leaves an items array inside an enum member alone', () => {
      const schema = { type: 'object', enum: [{ items: [1, 2] }] }
      normalizeDraftTuples(schema)
      enforceTupleLength(schema)
      expect(schema).toEqual({ type: 'object', enum: [{ items: [1, 2] }] })
    })

    it('leaves an items array inside examples alone', () => {
      const schema = { type: 'object', examples: [{ items: ['x'] }] }
      normalizeDraftTuples(schema)
      enforceTupleLength(schema)
      expect(schema).toEqual({ type: 'object', examples: [{ items: ['x'] }] })
    })

    it('still normalizes real subschemas beside a data keyword', () => {
      const schema = {
        type: 'object',
        default: { items: ['a'] },
        properties: { pair: { type: 'array', items: [{ type: 'string' }] } },
      }
      normalizeDraftTuples(schema)
      expect(schema).toEqual({
        type: 'object',
        default: { items: ['a'] },
        properties: { pair: { type: 'array', prefixItems: [{ type: 'string' }] } },
      })
    })
  })

  it('keeps an explicit minItems that makes trailing positions optional', () => {
    // Effect's `optionalElement` emits exactly this. Raising `minItems` to the
    // tuple's length made those positions required, rejecting arrays the
    // source schema accepts.
    const schema = { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], minItems: 1 }
    enforceTupleLength(schema)
    expect(schema.minItems).toBe(1)
  })
})
