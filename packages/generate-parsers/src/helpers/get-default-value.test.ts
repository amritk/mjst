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
      oneOf: [{ type: 'string' as const, default: 'from-oneof' }, { type: 'number' as const }],
    }
    expect(getDefaultValue(schema)).toBe('"from-oneof"')
  })

  it('recurses into oneOf when first schema has no explicit default', () => {
    const schema = {
      oneOf: [{ type: 'string' as const }, { type: 'number' as const }],
    }
    expect(getDefaultValue(schema)).toBe('""')
  })

  it('returns default from first anyOf schema', () => {
    const schema = {
      anyOf: [{ type: 'number' as const }],
    }
    expect(getDefaultValue(schema)).toBe('0')
  })

  it('returns default from first allOf schema', () => {
    const schema = {
      allOf: [{ type: 'boolean' as const }],
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

  it('returns null for the null type', () => {
    expect(getDefaultValue({ type: 'null' })).toBe('null')
  })

  it('returns undefined for a typeless schema with no other defaulting keyword', () => {
    expect(getDefaultValue({})).toBe('undefined')
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

  it('returns 0n for an x-mjst bigint schema', () => {
    expect(getDefaultValue({ 'x-mjst': { primitive: 'bigint' } })).toBe('0n')
  })

  it('returns a bare [] for an array with nothing required', () => {
    expect(getDefaultValue({ type: 'array', items: { type: 'string' } })).toBe('[]')
    expect(getDefaultValue({ type: 'array', prefixItems: [{ type: 'string' }] })).toBe('[]')
  })

  // A bare `[]` is not an instance of a tuple whose positions `minItems` made
  // required — and the emitted type says `[string, number]`, so the generated
  // file did not even compile.
  it('fills the tuple positions a minItems makes required', () => {
    expect(
      getDefaultValue({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        items: false,
        minItems: 2,
      }),
    ).toBe('["", 0]')
  })

  it('fills only up to minItems when the tuple is longer', () => {
    expect(
      getDefaultValue({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        minItems: 2,
      }),
    ).toBe('["", 0]')
  })

  it('pads past the tuple from the items tail', () => {
    expect(
      getDefaultValue({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' }, minItems: 3 }),
    ).toBe('["", 0, 0]')
  })

  it('satisfies minItems on a plain (non-tuple) array', () => {
    expect(getDefaultValue({ type: 'array', items: { type: 'string' }, minItems: 2 })).toBe('["", ""]')
  })

  it('honours each position own default/enum/const', () => {
    expect(
      getDefaultValue({
        type: 'array',
        prefixItems: [{ enum: ['a', 'b'] }, { const: 7 }],
        minItems: 2,
      }),
    ).toBe('["a", 7]')
  })

  // Half a tuple is no more assignable than none of it, so there is nothing to
  // gain from emitting a partial literal.
  it('gives up to [] when a required position has no concrete default', () => {
    expect(
      getDefaultValue({
        type: 'array',
        prefixItems: [{ type: 'string' }, { $ref: '#/$defs/thing' }],
        minItems: 2,
      }),
    ).toBe('[]')
    expect(getDefaultValue({ type: 'array', prefixItems: [{ type: 'string' }], items: false, minItems: 2 })).toBe('[]')
  })

  // `minItems` is schema-controlled and unbounded; a pathological value must not
  // inline thousands of elements into every generated file.
  it('caps the padding, keeping only what the emitted tuple type requires', () => {
    expect(
      getDefaultValue({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' }, minItems: 5000 }),
    ).toBe('[""]')
    expect(getDefaultValue({ type: 'array', items: { type: 'number' }, minItems: 5000 })).toBe('[]')
  })

  it('reads draft-07 tuple positions from an array-valued items', () => {
    expect(
      getDefaultValue({ type: 'array', items: [{ type: 'string' }, { type: 'number' }], minItems: 2 } as never),
    ).toBe('["", 0]')
  })

  // A fallback is only useful if it is an instance of the schema that produced
  // it — otherwise a coercing parser "repairs" a missing value into one the
  // schema still rejects.
  describe('scalar fallbacks satisfy their own constraints', () => {
    it('pads a string up to minLength', () => {
      expect(getDefaultValue({ type: 'string', minLength: 1 })).toBe('"x"')
      expect(getDefaultValue({ type: 'string', minLength: 3, maxLength: 4 })).toBe('"xxx"')
    })

    it('keeps the empty string when no lower bound asks otherwise', () => {
      expect(getDefaultValue({ type: 'string' })).toBe('""')
      expect(getDefaultValue({ type: 'string', maxLength: 4 })).toBe('""')
      expect(getDefaultValue({ type: 'string', minLength: 0 })).toBe('""')
    })

    it('caps the padding so a pathological minLength cannot inline a huge literal', () => {
      expect(getDefaultValue({ type: 'string', minLength: 100_000 })).toBe(`"${'x'.repeat(256)}"`)
    })

    it("leaves a pattern's own guess alone", () => {
      // Padding an arbitrary regex to a length is not something we can do safely.
      expect(getDefaultValue({ type: 'string', pattern: '^[a-z]{2}$', minLength: 2 })).toBe('""')
    })

    it('moves a number inside its bounds', () => {
      expect(getDefaultValue({ type: 'number', minimum: 5 })).toBe('5')
      expect(getDefaultValue({ type: 'number', maximum: -5 })).toBe('-5')
      expect(getDefaultValue({ type: 'number', exclusiveMinimum: 0 })).toBe('1')
      expect(getDefaultValue({ type: 'number', exclusiveMaximum: 0 })).toBe('-1')
      expect(getDefaultValue({ type: 'integer', minimum: 1 })).toBe('1')
      expect(getDefaultValue({ type: 'integer', exclusiveMinimum: 5 })).toBe('6')
    })

    it('keeps zero when zero is already in range', () => {
      expect(getDefaultValue({ type: 'number' })).toBe('0')
      expect(getDefaultValue({ type: 'integer', minimum: -10, maximum: 10 })).toBe('0')
      expect(getDefaultValue({ type: 'number', multipleOf: 3 })).toBe('0')
    })

    it('rounds up to a multiple of multipleOf', () => {
      expect(getDefaultValue({ type: 'number', multipleOf: 3, minimum: 4 })).toBe('6')
      expect(getDefaultValue({ type: 'integer', minimum: 1, maximum: 10, multipleOf: 4 })).toBe('4')
    })

    it('falls back to zero when the bounds cannot be satisfied', () => {
      // An unsatisfiable schema has no right answer; the historical `0` is no
      // worse than anything else we could invent.
      expect(getDefaultValue({ type: 'integer', minimum: 5, maximum: 6, multipleOf: 4 })).toBe('0')
      expect(getDefaultValue({ type: 'number', minimum: 10, maximum: 1 })).toBe('0')
    })
  })
})
