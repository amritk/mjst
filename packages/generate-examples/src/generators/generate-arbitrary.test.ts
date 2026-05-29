import { describe, expect, it } from 'vitest'

import { generateArbitrary } from './generate-arbitrary'

describe('generate-arbitrary', () => {
  it('generates a record arbitrary for an object schema', () => {
    const schema = {
      type: 'object' as const,
      properties: { name: { type: 'string' as const }, age: { type: 'integer' as const } },
      required: ['name'],
    }
    const code = generateArbitrary(schema, 'User')

    expect(code).toContain('export const UserArbitrary: fc.Arbitrary<User> =')
    expect(code).toContain('fc.record(')
    expect(code).toContain('"name": fc.string()')
    expect(code).toContain('"age": fc.integer()')
    expect(code).toContain('requiredKeys: ["name"]')
  })

  it('omits requiredKeys when every property is required', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'string' as const } },
      required: ['id'],
    }
    const code = generateArbitrary(schema, 'Doc')

    expect(code).toContain('fc.record({ "id": fc.string() })')
    expect(code).not.toContain('requiredKeys')
  })

  it('honours string length constraints', () => {
    const schema = { type: 'string' as const, minLength: 2, maxLength: 8 }
    expect(generateArbitrary(schema, 'Code')).toContain('fc.string({ minLength: 2, maxLength: 8 })')
  })

  it('maps string formats to dedicated arbitraries', () => {
    expect(generateArbitrary({ type: 'string', format: 'email' }, 'E')).toContain('fc.emailAddress()')
    expect(generateArbitrary({ type: 'string', format: 'uuid' }, 'U')).toContain('fc.uuid()')
    expect(generateArbitrary({ type: 'string', format: 'date-time' }, 'D')).toContain(
      'fc.date({ noInvalidDate: true }).map((d) => d.toISOString())',
    )
  })

  it('uses stringMatching for pattern constraints', () => {
    const schema = { type: 'string' as const, pattern: '^[a-z]+$' }
    expect(generateArbitrary(schema, 'Slug')).toContain('fc.stringMatching(/^[a-z]+$/)')
  })

  it('honours integer range and multipleOf', () => {
    const schema = { type: 'integer' as const, minimum: 0, maximum: 10, multipleOf: 2 }
    const code = generateArbitrary(schema, 'Even')
    expect(code).toContain('fc.integer({ min: 0, max: 10 })')
    expect(code).toContain('.filter((n) => n % 2 === 0)')
  })

  it('adjusts exclusive integer bounds', () => {
    const schema = { type: 'integer' as const, exclusiveMinimum: 0, exclusiveMaximum: 10 }
    expect(generateArbitrary(schema, 'N')).toContain('fc.integer({ min: 1, max: 9 })')
  })

  it('uses excluded bounds for numbers', () => {
    const schema = { type: 'number' as const, exclusiveMinimum: 0, maximum: 1 }
    const code = generateArbitrary(schema, 'Ratio')
    expect(code).toContain('min: 0, minExcluded: true')
    expect(code).toContain('max: 1')
  })

  it('generates fc.constantFrom for enums and fc.constant for const', () => {
    expect(generateArbitrary({ enum: ['a', 'b'] }, 'Choice')).toContain('fc.constantFrom("a", "b")')
    expect(generateArbitrary({ const: 42 }, 'Answer')).toContain('fc.constant(42)')
  })

  it('references the imported arbitrary for $ref', () => {
    const schema = {
      type: 'object' as const,
      properties: { address: { $ref: '#/$defs/address' } },
      required: ['address'],
    }
    expect(generateArbitrary(schema, 'User')).toContain('"address": AddressArbitrary')
  })

  it('generates fc.array with bounds and uniqueArray for unique items', () => {
    expect(generateArbitrary({ type: 'array', items: { type: 'string' }, minItems: 1 }, 'List')).toContain(
      'fc.array(fc.string(), { minLength: 1 })',
    )
    expect(generateArbitrary({ type: 'array', items: { type: 'number' }, uniqueItems: true }, 'Set')).toContain(
      'fc.uniqueArray(fc.double',
    )
  })

  it('generates fc.oneof for unions', () => {
    const schema = { oneOf: [{ type: 'string' as const }, { type: 'number' as const }] }
    expect(generateArbitrary(schema, 'StringOrNumber')).toContain('fc.oneof(fc.string(), fc.double(')
  })

  it('maps x-mjst Date and bigint to fc.date and fc.bigInt', () => {
    expect(generateArbitrary({ 'x-mjst': { instanceOf: 'Date' } } as never, 'When')).toContain('fc.date(')
    expect(generateArbitrary({ 'x-mjst': { primitive: 'bigint' } } as never, 'Big')).toContain('fc.bigInt()')
  })
})
