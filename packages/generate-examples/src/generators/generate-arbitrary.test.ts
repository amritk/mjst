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
    expect(generateArbitrary(schema, 'Slug')).toContain('fc.stringMatching(new RegExp("^[a-z]+$"))')
  })

  it('escapes a pattern containing a slash instead of breaking the regex literal', () => {
    const schema = { type: 'string' as const, pattern: '^/api/v\\d+$' }
    const code = generateArbitrary(schema, 'Path')
    // A `/`-bearing pattern must not be inlined into a `/.../ ` literal.
    expect(code).toContain('fc.stringMatching(new RegExp("^/api/v\\\\d+$"))')
    expect(code).not.toContain('fc.stringMatching(/')
  })

  it('preserves min/maxLength alongside a pattern via a filter', () => {
    const schema = { type: 'string' as const, pattern: '^[a-z]+$', minLength: 3, maxLength: 8 }
    const code = generateArbitrary(schema, 'Bounded')
    expect(code).toContain('.filter((s) => s.length >= 3 && s.length <= 8)')
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

  it('honours the tighter bound when both minimum and exclusiveMinimum are present', () => {
    // minimum 5 vs exclusiveMinimum 9 → effective min is 10 (9 + 1), not 5.
    const schema = { type: 'integer' as const, minimum: 5, exclusiveMinimum: 9 }
    expect(generateArbitrary(schema, 'Tight')).toContain('fc.integer({ min: 10 })')
  })

  it('uses excluded bounds for numbers', () => {
    const schema = { type: 'number' as const, exclusiveMinimum: 0, maximum: 1 }
    const code = generateArbitrary(schema, 'Ratio')
    expect(code).toContain('min: 0, minExcluded: true')
    expect(code).toContain('max: 1')
  })

  it('rounds fractional integer bounds to satisfiable integers', () => {
    // fc.integer rejects non-integral bounds, so 2.5 must round up to 3 and an
    // exclusive 5.5 up to 6 (smallest integer that still satisfies the bound).
    expect(generateArbitrary({ type: 'integer', minimum: 2.5 }, 'A')).toContain('fc.integer({ min: 3 })')
    expect(generateArbitrary({ type: 'integer', exclusiveMinimum: 5.5 }, 'B')).toContain('fc.integer({ min: 6 })')
    expect(generateArbitrary({ type: 'integer', maximum: 7.5 }, 'C')).toContain('fc.integer({ max: 7 })')
    expect(generateArbitrary({ type: 'integer', exclusiveMaximum: 7.5 }, 'D')).toContain('fc.integer({ max: 7 })')
  })

  it('honours the tighter number bound when inclusive and exclusive are both present', () => {
    // exclusiveMinimum 5 is tighter than minimum 0, so the exclusive bound must
    // win rather than being shadowed by the inclusive one.
    const low = generateArbitrary({ type: 'number', minimum: 0, exclusiveMinimum: 5 }, 'Low')
    expect(low).toContain('min: 5, minExcluded: true')
    expect(low).not.toContain('min: 0')

    const high = generateArbitrary({ type: 'number', maximum: 10, exclusiveMaximum: 3 }, 'High')
    expect(high).toContain('max: 3, maxExcluded: true')
    expect(high).not.toContain('max: 10')
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

  it('maps network and time string formats to dedicated arbitraries', () => {
    expect(generateArbitrary({ type: 'string', format: 'hostname' }, 'H')).toContain('fc.domain()')
    expect(generateArbitrary({ type: 'string', format: 'ipv4' }, 'A')).toContain('fc.ipV4()')
    expect(generateArbitrary({ type: 'string', format: 'ipv6' }, 'B')).toContain('fc.ipV6()')
    expect(generateArbitrary({ type: 'string', format: 'time' }, 'T')).toContain('.toISOString().slice(11)')
  })

  it('generates fc.oneof for multi-type schemas', () => {
    const schema = { type: ['string', 'null'] as const }
    expect(generateArbitrary(schema, 'Nullable')).toContain('fc.oneof(fc.string(), fc.constant(null))')
  })

  it('unwraps a single-member type array to the bare arbitrary', () => {
    expect(generateArbitrary({ type: ['integer'] as const }, 'Solo')).toContain('= fc.integer()')
  })

  it('generates fc.tuple for prefixItems (2020-12 tuples)', () => {
    const schema = {
      type: 'array' as const,
      prefixItems: [{ type: 'string' as const }, { type: 'integer' as const }],
      items: false,
    }
    expect(generateArbitrary(schema, 'Pair')).toContain('fc.tuple(fc.string(), fc.integer())')
  })

  it('generates fc.tuple for the draft-07 array-form items', () => {
    const schema = { type: 'array' as const, items: [{ type: 'boolean' as const }, { type: 'string' as const }] }
    expect(generateArbitrary(schema, 'T')).toContain('fc.tuple(fc.boolean(), fc.string())')
  })

  it('merges allOf branches into a single record arbitrary', () => {
    const schema = {
      allOf: [
        { type: 'object' as const, properties: { a: { type: 'string' as const } }, required: ['a'] },
        { type: 'object' as const, properties: { b: { type: 'integer' as const } }, required: ['b'] },
      ],
    }
    const code = generateArbitrary(schema, 'Merged')
    expect(code).toContain('"a": fc.string()')
    expect(code).toContain('"b": fc.integer()')
    // allOf collapses to one record, not an fc.oneof / fc.anything fallback.
    expect(code).not.toContain('fc.anything()')
    expect(code).not.toContain('fc.oneof')
  })

  it('generates fc.dictionary for a map-style object with typed additionalProperties', () => {
    const schema = { type: 'object' as const, additionalProperties: { type: 'integer' as const } }
    expect(generateArbitrary(schema, 'Scores')).toContain('fc.dictionary(fc.string(), fc.integer())')
  })

  it('composes a dictionary of extras when properties and additionalProperties coexist', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'string' as const } },
      required: ['id'],
      additionalProperties: { type: 'number' as const },
    }
    const code = generateArbitrary(schema, 'Open')
    expect(code).toContain('"id": fc.string()')
    expect(code).toContain('fc.dictionary(fc.string(), fc.double(')
  })

  it('ties a self-referential schema with fc.letrec instead of a bare identifier', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        value: { type: 'string' as const },
        children: { type: 'array' as const, items: { $ref: '#/$defs/node' } },
      },
      required: ['value'],
    }
    const code = generateArbitrary(schema, 'Node')
    // The self-reference resolves to `tie('self')`, wrapped in fc.letrec — never a
    // bare `NodeArbitrary` that would TDZ-crash on import.
    expect(code).toContain('fc.letrec')
    expect(code).toContain('tie("self")')
    expect(code).not.toContain('fc.array(NodeArbitrary)')
  })

  it('builds a number multipleOf analytically instead of a starving filter', () => {
    const schema = { type: 'number' as const, minimum: 0, maximum: 10, multipleOf: 0.5 }
    const code = generateArbitrary(schema, 'HalfStep')
    // Random doubles almost never satisfy `n % m === 0`, so no `.filter` — the
    // multiple is derived from an integer `k` instead.
    expect(code).not.toContain('.filter(')
    expect(code).toContain('fc.integer({ min: 0, max: 20 })')
    expect(code).toContain('.map((k) => Math.min(Math.max(k * 0.5, 0), 10))')
  })

  it('samples schema-valid multiples for a number multipleOf without over-filtering', async () => {
    const fc = await import('fast-check')
    const schema = { type: 'number' as const, minimum: 0, maximum: 10, multipleOf: 0.5 }
    const code = generateArbitrary(schema, 'HalfStep')

    // Eval the generated RHS with `fc` in scope, mimicking the compiled module.
    // The pre-fix `.filter` construction throws "too many filtered values" here.
    const rhs = code.slice(code.indexOf('=') + 1)
    const arbitrary = new Function('fc', `return (${rhs})`)(fc) as import('fast-check').Arbitrary<number>
    const samples = fc.sample(arbitrary, 100)

    expect(samples).toHaveLength(100)
    for (const n of samples) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(10)
      // Every sample is a multiple of 0.5.
      expect(Math.abs(n / 0.5 - Math.round(n / 0.5))).toBeLessThan(1e-9)
    }
  })

  it('respects exclusive bounds when deriving a number multipleOf', async () => {
    const fc = await import('fast-check')
    // exclusiveMinimum 0 + multipleOf 2 → smallest valid k is 1 (value 2); the
    // upper end excludes 10, so the largest is k = 4 (value 8).
    const schema = { type: 'number' as const, exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 2 }
    const code = generateArbitrary(schema, 'Strict')
    expect(code).toContain('fc.integer({ min: 1, max: 4 })')

    const rhs = code.slice(code.indexOf('=') + 1)
    const arbitrary = new Function('fc', `return (${rhs})`)(fc) as import('fast-check').Arbitrary<number>
    for (const n of fc.sample(arbitrary, 50)) {
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThan(10)
      expect(n % 2).toBe(0)
    }
  })

  it('produces recursive arbitrary code that imports and samples without crashing', async () => {
    const fc = await import('fast-check')
    const schema = {
      type: 'object' as const,
      properties: {
        value: { type: 'string' as const },
        next: { $ref: '#/$defs/node' },
      },
      required: ['value'],
    }
    const code = generateArbitrary(schema, 'Node')
    // Strip the `export const X: fc.Arbitrary<Node> =` prefix, then drop the TS-only
    // `fc.letrec<{ self: Node }>` type argument so the remaining RHS is plain JS we
    // can eval with `fc` in scope, mimicking the compiled module. A TDZ bug (the
    // pre-letrec behaviour) would throw a ReferenceError right here.
    const rhs = code.slice(code.indexOf('=') + 1).replace(/fc\.letrec<[^>]*>/, 'fc.letrec')
    const arbitrary = new Function('fc', `return (${rhs})`)(fc) as import('fast-check').Arbitrary<unknown>
    const sample = fc.sample(arbitrary, 1)[0]
    expect(sample).toBeDefined()
    expect(typeof (sample as { value: unknown }).value).toBe('string')
  })
})
