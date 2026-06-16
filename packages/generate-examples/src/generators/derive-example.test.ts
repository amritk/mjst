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
})
