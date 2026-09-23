import { describe, expect, it } from 'vitest'

import { deriveExample, generateExampleConst, serializeValue } from './derive-example'

describe('deriveExample', () => {
  it('prefers const, then examples, then default, then enum', () => {
    expect(deriveExample({ const: 5 })).toBe(5)
    expect(deriveExample({ examples: ['a', 'b'] } as never)).toBe('a')
    expect(deriveExample({ default: true } as never)).toBe(true)
    expect(deriveExample({ enum: ['x', 'y'] })).toBe('x')
  })

  it('produces canonical values per type', () => {
    expect(deriveExample({ type: 'string' })).toBe('string')
    expect(deriveExample({ type: 'integer' })).toBe(0)
    expect(deriveExample({ type: 'number', minimum: 3 })).toBe(3)
    expect(deriveExample({ type: 'boolean' })).toBe(true)
    expect(deriveExample({ type: 'null' })).toBe(null)
  })

  it('honours string formats and length', () => {
    expect(deriveExample({ type: 'string', format: 'email' })).toBe('user@example.com')
    expect(deriveExample({ type: 'string', format: 'ipv4' })).toBe('127.0.0.1')
    expect(deriveExample({ type: 'string', format: 'hostname' })).toBe('example.com')
    expect(deriveExample({ type: 'string', minLength: 10 })).toHaveLength(10)
  })

  it('derives from the first member of a multi-type schema', () => {
    expect(deriveExample({ type: ['string', 'null'] })).toBe('string')
    expect(deriveExample({ type: ['null', 'integer'] })).toBe(null)
  })

  it('builds nested objects including all declared properties', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'string' as const }, count: { type: 'integer' as const } },
      required: ['id'],
    }
    expect(deriveExample(schema)).toEqual({ id: 'string', count: 0 })
  })

  it('builds arrays honouring minItems', () => {
    expect(deriveExample({ type: 'array', items: { type: 'string' }, minItems: 2 })).toEqual(['string', 'string'])
  })

  it('resolves $ref values against the root schema', () => {
    const root = { $defs: { id: { type: 'string', const: 'abc' } } }
    expect(deriveExample({ $ref: '#/$defs/id' }, root)).toBe('abc')
  })

  it('short-circuits recursive $refs to null', () => {
    const root = {
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
    }
    expect(deriveExample({ $ref: '#/$defs/node' }, root)).toEqual({ next: null })
  })
})

describe('serializeValue', () => {
  it('serializes bigint and Date as runtime expressions', () => {
    expect(serializeValue(0n)).toBe('0n')
    expect(serializeValue(new Date(0))).toBe('new Date("1970-01-01T00:00:00.000Z")')
  })

  it('omits undefined object properties', () => {
    expect(serializeValue({ a: 1, b: undefined })).toBe('{ "a": 1 }')
  })

  it('serializes nested arrays and objects', () => {
    expect(serializeValue({ items: [1, 2] })).toBe('{ "items": [1, 2] }')
  })
})

describe('deriveExample — satisfiable-instance regressions', () => {
  it('keeps a multipleOf value within the upper bound', () => {
    // 10 is the only multiple of 5 in [6, 12]; must not overshoot to 15.
    expect(deriveExample({ type: 'integer', minimum: 6, maximum: 12, multipleOf: 5 })).toBe(10)
  })

  it('clears an exclusive lower bound inside a narrow range', () => {
    // A fixed half-unit nudge landed on 0.5, past the 0.01 maximum.
    expect(deriveExample({ type: 'number', exclusiveMinimum: 0, maximum: 0.01 })).toBe(0.005)
    expect(deriveExample({ type: 'number', exclusiveMinimum: 0.1, exclusiveMaximum: 0.2 })).toBeCloseTo(0.15)
  })

  it('honours exclusiveMaximum alongside a looser maximum', () => {
    expect(deriveExample({ type: 'number', maximum: 10, exclusiveMaximum: -3 })).toBe(-3.5)
  })

  it('clears an exclusive bound by one multipleOf step', () => {
    expect(deriveExample({ type: 'number', minimum: 9.8, exclusiveMaximum: 10, multipleOf: 0.1 })).toBeCloseTo(9.8)
    expect(deriveExample({ type: 'number', exclusiveMinimum: 0, multipleOf: 0.25 })).toBe(0.25)
  })

  it('rounds fractional bounds inward on an integer', () => {
    expect(deriveExample({ type: 'integer', maximum: -0.5 })).toBe(-1)
    expect(deriveExample({ type: 'integer', exclusiveMinimum: 1.5, maximum: 2 })).toBe(2)
  })

  it('steps an integer by a whole multiple of a fractional multipleOf', () => {
    expect(deriveExample({ type: 'integer', minimum: 1, multipleOf: 2.5 })).toBe(5)
  })

  it('produces distinct uniqueItems that respect the item schema', () => {
    expect(
      deriveExample({
        type: 'array',
        uniqueItems: true,
        minItems: 3,
        items: { type: 'integer', minimum: 0, maximum: 6, multipleOf: 3 },
      }),
    ).toEqual([0, 3, 6])
  })

  it('pads a tuple to minItems when additional items are allowed', () => {
    expect(deriveExample({ type: 'array', prefixItems: [{ type: 'string' }], minItems: 3 })).toEqual([
      'string',
      null,
      null,
    ])
  })

  it('does not pad past a closed tuple (items: false)', () => {
    expect(deriveExample({ type: 'array', prefixItems: [{ type: 'string' }], items: false, minItems: 3 })).toEqual([
      'string',
    ])
  })

  it('intersects enums across allOf branches', () => {
    expect(
      deriveExample({
        allOf: [
          { type: 'string', enum: ['a', 'b'] },
          { type: 'string', enum: ['c', 'b'] },
        ],
      }),
    ).toBe('b')
  })
})

describe('generateExampleConst', () => {
  it('emits a typed const with a derived value', () => {
    const schema = { type: 'object' as const, properties: { name: { type: 'string' as const } } }
    expect(generateExampleConst(schema, 'Info')).toBe('export const infoExample: Info = { "name": "string" }')
  })

  it('falls back instead of throwing on a pattern that will not compile', () => {
    // A schema may carry a `pattern` that is not a valid JavaScript regex. The
    // compile threw a bare SyntaxError out of the generator and ended the run,
    // while the `patternProperties` compile in the same file already tolerated
    // it. Emitting the fallback string leaves the invalid schema to be reported
    // where invalid schemas are reported.
    for (const pattern of ['*bad', 'a{2,1}', '(?<dup>x)(?<dup>y)']) {
      expect(() => deriveExample({ type: 'string', pattern } as never)).not.toThrow()
      expect(typeof deriveExample({ type: 'string', pattern } as never)).toBe('string')
    }
  })

  it('ignores a format naming a prototype member rather than emitting a function', () => {
    // `format` is schema input. A bare index found `Function.prototype.valueOf`
    // — not a string — so the emitted `fooExample` carried `undefined` for the
    // property and the generated file failed to type-check.
    for (const format of ['toString', 'valueOf', 'constructor']) {
      expect(typeof deriveExample({ type: 'string', format } as never)).toBe('string')
    }
  })
})
