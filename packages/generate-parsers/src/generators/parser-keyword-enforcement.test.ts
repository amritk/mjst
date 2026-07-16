import { describe, expect, it } from 'vitest'

import { evalGenerated } from './differential.test-utils'
import { generateParserFunction } from './generate-parser-function'

/**
 * Unit coverage for the strict-mode enforcement of the JSON Schema keywords the
 * parser generator historically ignored — `contains` / `minContains` /
 * `maxContains`, `dependentRequired`, `dependentSchemas`, and `propertyNames` —
 * plus the generation-time guard that rejects keywords it cannot enforce. Each
 * keyword is checked in both strict mode (throws on violation) and coerce mode
 * (ignored: the coercing parser is documented to repair, not reject).
 */

const strictParser = (schema: unknown): ((input: unknown) => unknown) =>
  evalGenerated(generateParserFunction(schema as never, 'Root', { strict: true }), 'parseRoot')

const coerceParser = (schema: unknown): ((input: unknown) => unknown) =>
  evalGenerated(generateParserFunction(schema as never, 'Root', { strict: false }), 'parseRoot')

describe('strict parser: contains / minContains / maxContains', () => {
  it('enforces the default minContains of 1 on a root array', () => {
    const parse = strictParser({ type: 'array', items: { type: 'number' }, contains: { type: 'number', minimum: 5 } })
    expect(parse([1, 2, 9])).toEqual([1, 2, 9])
    expect(() => parse([1, 2, 3])).toThrow(/does not contain the required matching items/)
  })

  it('enforces minContains and maxContains bounds', () => {
    const parse = strictParser({
      type: 'array',
      items: { type: 'number' },
      contains: { type: 'number', minimum: 5 },
      minContains: 2,
      maxContains: 3,
    })
    expect(parse([5, 6])).toEqual([5, 6])
    expect(parse([5, 6, 7])).toEqual([5, 6, 7])
    expect(() => parse([5])).toThrow() // 1 match < 2
    expect(() => parse([5, 6, 7, 8])).toThrow() // 4 matches > 3
  })

  it('treats minContains: 0 as always satisfying the lower bound', () => {
    const parse = strictParser({ type: 'array', contains: { const: 'x' }, minContains: 0 })
    expect(parse([])).toEqual([])
    expect(parse(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('enforces contains on an object property', () => {
    const parse = strictParser({
      type: 'object',
      properties: { xs: { type: 'array', contains: { const: 'x' } } },
      required: ['xs'],
    })
    expect(parse({ xs: ['a', 'x'] })).toEqual({ xs: ['a', 'x'] })
    expect(() => parse({ xs: ['a', 'b'] })).toThrow()
  })

  it('is ignored in coerce mode', () => {
    const parse = coerceParser({ type: 'array', items: { type: 'number' }, contains: { type: 'number', minimum: 5 } })
    expect(() => parse([1, 2, 3])).not.toThrow()
  })
})

describe('strict parser: dependentRequired', () => {
  const schema = {
    type: 'object',
    properties: { creditCard: { type: 'number' }, billingAddress: { type: 'string' } },
    dependentRequired: { creditCard: ['billingAddress'] },
  }

  it('requires the dependency when the trigger is present', () => {
    const parse = strictParser(schema)
    expect(parse({ creditCard: 123, billingAddress: 'x' })).toEqual({ creditCard: 123, billingAddress: 'x' })
    expect(parse({ billingAddress: 'x' })).toEqual({ billingAddress: 'x' })
    expect(parse({})).toEqual({})
    expect(() => parse({ creditCard: 123 })).toThrow(/must have property 'billingAddress' when 'creditCard' is present/)
  })

  it('is ignored in coerce mode', () => {
    expect(() => coerceParser(schema)({ creditCard: 123 })).not.toThrow()
  })
})

describe('strict parser: dependentSchemas', () => {
  it('applies the subschema to the whole object when the trigger is present', () => {
    const parse = strictParser({
      type: 'object',
      properties: { creditCard: { type: 'number' } },
      dependentSchemas: {
        creditCard: { required: ['billingAddress'], properties: { billingAddress: { type: 'string' } } },
      },
    })
    expect(parse({ creditCard: 1, billingAddress: 'x' })).toEqual({ creditCard: 1, billingAddress: 'x' })
    expect(parse({})).toEqual({})
    expect(() => parse({ creditCard: 1 })).toThrow() // missing billingAddress
    expect(() => parse({ creditCard: 1, billingAddress: 9 })).toThrow() // wrong type
  })

  it('a false subschema forbids the trigger property', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { type: 'string' } },
      dependentSchemas: { a: false },
    })
    expect(parse({})).toEqual({})
    expect(() => parse({ a: 'x' })).toThrow(/must NOT have property 'a'/)
  })

  it('a true subschema is a no-op', () => {
    const parse = strictParser({ type: 'object', properties: { a: { type: 'string' } }, dependentSchemas: { a: true } })
    expect(parse({ a: 'x' })).toEqual({ a: 'x' })
  })
})

describe('strict parser: propertyNames', () => {
  it('rejects keys that violate the name subschema (pattern)', () => {
    const parse = strictParser({ type: 'object', propertyNames: { pattern: '^[a-z]+$' } })
    expect(parse({ abc: 1, def: 2 })).toEqual({ abc: 1, def: 2 })
    expect(() => parse({ ABC: 1 })).toThrow(/invalid property name/)
  })

  it('enforces maxLength on keys (type-less string constraint) alongside declared properties', () => {
    const parse = strictParser({
      type: 'object',
      properties: { ok: { type: 'number' } },
      propertyNames: { maxLength: 3 },
    })
    expect(parse({ ok: 1 })).toEqual({ ok: 1 })
    expect(() => parse({ toolong: 1 })).toThrow()
  })

  it('enforces an enum of allowed key names', () => {
    const parse = strictParser({ type: 'object', propertyNames: { enum: ['a', 'b'] } })
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => parse({ a: 1, c: 3 })).toThrow()
  })

  it('is ignored in coerce mode', () => {
    expect(() => coerceParser({ type: 'object', propertyNames: { pattern: '^[a-z]+$' } })({ ABC: 1 })).not.toThrow()
  })
})

describe('strict parser: nested inline objects', () => {
  it('enforces object-level keywords inside a nested inline object (via its sub-parser)', () => {
    const parse = strictParser({
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'string' } },
          dependentRequired: { a: ['b'] },
          propertyNames: { pattern: '^[a-z]+$' },
        },
      },
      required: ['inner'],
    })
    expect(parse({ inner: { a: 'x', b: 'y' } })).toEqual({ inner: { a: 'x', b: 'y' } })
    expect(() => parse({ inner: { a: 'x' } })).toThrow() // nested dependentRequired
    expect(() => parse({ inner: { Z: 1 } })).toThrow() // nested propertyNames
  })
})

describe('strict parser: object-level keywords alongside patternProperties / additionalProperties', () => {
  it('asserts declared properties (type + required) in the combined props/patternProperties parser', () => {
    // The combined parser builds its result from the coercing property lines, so
    // strict mode used to repair a wrong type / default a missing required key
    // instead of throwing. It must now assert declared properties.
    const parse = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(
        {
          type: 'object',
          properties: { count: { type: 'number' } },
          patternProperties: { '^x-': { type: 'string' } },
          additionalProperties: false,
          required: ['count'],
        } as never,
        'Root',
        { strict: true, useRefImports: true },
      ),
      'parseRoot',
    )
    expect(parse({ count: 5, 'x-a': 'ok' })).toEqual({ count: 5, 'x-a': 'ok' })
    expect(() => parse({ count: 'nope' })).toThrow(/field 'count' expected number/)
    expect(() => parse({})).toThrow(/missing required property 'count'/)
    expect(() => parse({ count: 5, junk: 1 })).toThrow(/unknown property "junk"/)
  })

  it('enforces propertyNames with patternProperties + additionalProperties: false', () => {
    const parse = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          patternProperties: { '^x': { type: 'number' } },
          propertyNames: { pattern: '^[a-z]+$' },
          additionalProperties: false,
        } as never,
        'Root',
        { strict: true, useRefImports: true },
      ),
      'parseRoot',
    )
    expect(parse({ a: 's', xy: 1 })).toEqual({ a: 's', xy: 1 })
    expect(() => parse({ a: 's', xABC: 1 })).toThrow() // pattern-matched key violates propertyNames
  })

  it('enforces propertyNames with an open patternProperties map', () => {
    const parse = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(
        { type: 'object', patternProperties: { '^x': { type: 'number' } }, propertyNames: { maxLength: 2 } } as never,
        'Root',
        { strict: true, useRefImports: true },
      ),
      'parseRoot',
    )
    expect(parse({ xy: 1 })).toEqual({ xy: 1 })
    expect(() => parse({ xyz: 1 })).toThrow()
  })

  it('enforces dependentRequired on an additionalProperties record', () => {
    const parse = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(
        { type: 'object', additionalProperties: { type: 'number' }, dependentRequired: { a: ['b'] } } as never,
        'Root',
        { strict: true, useRefImports: true },
      ),
      'parseRoot',
    )
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => parse({ a: 1 })).toThrow()
  })
})

describe('generation-time guard (strict only)', () => {
  it('throws for unevaluatedProperties: false', () => {
    expect(() =>
      generateParserFunction({ type: 'object', properties: {}, unevaluatedProperties: false } as never, 'Root', {
        strict: true,
      }),
    ).toThrow(/unevaluatedProperties/)
  })

  it('throws for unevaluatedItems with a constraining schema', () => {
    expect(() =>
      generateParserFunction({ type: 'array', unevaluatedItems: { type: 'string' } } as never, 'Root', {
        strict: true,
      }),
    ).toThrow(/unevaluatedItems/)
  })

  it('allows unevaluatedProperties: true (no constraint)', () => {
    expect(() =>
      generateParserFunction({ type: 'object', properties: {}, unevaluatedProperties: true } as never, 'Root', {
        strict: true,
      }),
    ).not.toThrow()
  })

  it('throws for a contains subschema it cannot prove inline ($ref)', () => {
    expect(() =>
      generateParserFunction({ type: 'array', contains: { $ref: '#/$defs/x' } } as never, 'Root', { strict: true }),
    ).toThrow(/contains/)
  })

  it('throws for a propertyNames subschema it cannot prove inline (combinator)', () => {
    expect(() =>
      generateParserFunction(
        { type: 'object', propertyNames: { anyOf: [{ pattern: '^a' }, { pattern: '^b' }] } } as never,
        'Root',
        { strict: true },
      ),
    ).toThrow(/propertyNames/)
  })

  it('throws for a dependentSchemas subschema it cannot prove inline ($ref)', () => {
    expect(() =>
      generateParserFunction(
        { type: 'object', properties: { a: {} }, dependentSchemas: { a: { $ref: '#/$defs/x' } } } as never,
        'Root',
        { strict: true },
      ),
    ).toThrow(/dependentSchemas/)
  })

  it('does not throw in coerce mode for unsupported keywords', () => {
    expect(() =>
      generateParserFunction({ type: 'object', properties: {}, unevaluatedProperties: false } as never, 'Root', {
        strict: false,
      }),
    ).not.toThrow()
    expect(() =>
      generateParserFunction({ type: 'array', contains: { $ref: '#/$defs/x' } } as never, 'Root', { strict: false }),
    ).not.toThrow()
  })
})

describe('strict parser: typed record (additionalProperties)', () => {
  it('throws on a wrong-typed record value instead of coercing it', () => {
    const parse = strictParser({ type: 'object', additionalProperties: { type: 'number' } })
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => parse({ a: 'not-a-number' })).toThrow(/record value must be number/)
  })

  it('enforces integrality for an integer-valued record', () => {
    const parse = strictParser({ type: 'object', additionalProperties: { type: 'integer' } })
    expect(parse({ a: 3 })).toEqual({ a: 3 })
    expect(() => parse({ a: 1.5 })).toThrow(/record value must be integer/)
  })

  it('coerce mode still repairs a wrong-typed record value', () => {
    const parse = coerceParser({ type: 'object', additionalProperties: { type: 'number' } })
    expect(parse({ a: 'not-a-number' })).toEqual({ a: 0 })
  })
})
