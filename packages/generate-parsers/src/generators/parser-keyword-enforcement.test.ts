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

describe('strict parser: unevaluatedProperties / unevaluatedItems', () => {
  it('rejects a property no other keyword evaluated', () => {
    const parse = strictParser({ type: 'object', properties: { a: {} }, unevaluatedProperties: false })
    expect(parse({ a: 1 })).toEqual({ a: 1 })
    expect(() => parse({ b: 1 })).toThrow(/must NOT have unevaluated properties/)
  })

  it('counts the properties an allOf member evaluated', () => {
    const parse = strictParser({
      allOf: [{ properties: { a: {} } }],
      properties: { b: {} },
      unevaluatedProperties: false,
    })
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => parse({ c: 3 })).toThrow(/must NOT have unevaluated properties/)
  })

  it('counts a branch only when that branch matches', () => {
    const parse = strictParser({
      anyOf: [
        { properties: { a: { type: 'number' } }, required: ['a'] },
        { properties: { b: { type: 'number' } }, required: ['b'] },
      ],
      unevaluatedProperties: false,
    })
    expect(parse({ a: 1 })).toEqual({ a: 1 })
    // The branch that would have evaluated `a` fails on its type, so `a` is left
    // unevaluated even though the *other* branch validates the value.
    expect(() => parse({ b: 1, a: 'no' })).toThrow(/must NOT have unevaluated properties/)
  })

  it('validates leftovers against a schema-form unevaluatedProperties', () => {
    const parse = strictParser({ type: 'object', properties: { a: {} }, unevaluatedProperties: { type: 'number' } })
    expect(parse({ a: 'anything', b: 1 })).toEqual({ a: 'anything', b: 1 })
    expect(() => parse({ b: 'x' })).toThrow(/must NOT have unevaluated properties/)
  })

  it('rejects an item past the tuple positions', () => {
    const parse = strictParser({ type: 'array', prefixItems: [{ type: 'number' }], unevaluatedItems: false })
    expect(parse([1])).toEqual([1])
    expect(() => parse([1, 2])).toThrow(/must NOT have unevaluated items/)
  })

  it('validates leftover items against a schema-form unevaluatedItems', () => {
    const parse = strictParser({
      type: 'array',
      prefixItems: [{ type: 'number' }],
      unevaluatedItems: { type: 'string' },
    })
    expect(parse([1, 'a'])).toEqual([1, 'a'])
    expect(() => parse([1, 2])).toThrow(/must NOT have unevaluated items/)
  })

  it('ignores them in coerce mode, like every other rejecting keyword', () => {
    const parse = coerceParser({ type: 'object', properties: { a: {} }, unevaluatedProperties: false })
    expect(parse({ b: 1 })).toEqual({ b: 1 })
  })
})

describe('generation-time guard (strict only)', () => {
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

  it('throws for a propertyNames subschema it cannot prove inline ($ref)', () => {
    expect(() =>
      generateParserFunction({ type: 'object', propertyNames: { $ref: '#/$defs/name' } } as never, 'Root', {
        strict: true,
      }),
    ).toThrow(/propertyNames/)
  })

  it('accepts — and enforces — a combinator propertyNames subschema', () => {
    const parse = strictParser({
      type: 'object',
      propertyNames: { anyOf: [{ pattern: '^a' }, { pattern: '^b' }] },
    })
    expect(parse({ ab: 1, ba: 2 })).toEqual({ ab: 1, ba: 2 })
    expect(() => parse({ zz: 1 })).toThrow(/invalid property name/)
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
    expect(() => parse({ a: 'not-a-number' })).toThrow(/invalid value for property a/)
  })

  it('enforces integrality for an integer-valued record', () => {
    const parse = strictParser({ type: 'object', additionalProperties: { type: 'integer' } })
    expect(parse({ a: 3 })).toEqual({ a: 3 })
    expect(() => parse({ a: 1.5 })).toThrow(/invalid value for property a/)
  })

  it('coerce mode still repairs a wrong-typed record value', () => {
    const parse = coerceParser({ type: 'object', additionalProperties: { type: 'number' } })
    expect(parse({ a: 'not-a-number' })).toEqual({ a: 0 })
  })
})

/**
 * Regressions for the keyword families that were silently unenforced in strict
 * mode. Every one of them needs *both* halves to hold: the slow-path assertion
 * has to reject the value, and the fast-path guard has to decline to wave it
 * through first — a guard built from flat per-property type checks cannot mirror
 * any of these, so each schema below is also a `hasFastPathBlockingKeyword`
 * case. `parser-composition-conformance.differential.test.ts` fuzzes the same
 * surface against Ajv; these pin the individual failures with readable messages.
 */
describe('strict parser: const', () => {
  it('enforces a scalar const on a property', () => {
    const parse = strictParser({ type: 'object', properties: { a: { const: 'x' } }, required: ['a'] })
    expect(parse({ a: 'x' })).toEqual({ a: 'x' })
    expect(() => parse({ a: 'y' })).toThrow(/must be "x"/)
    expect(() => parse({ a: 1 })).toThrow(/must be "x"/)
  })

  it('enforces a structural const by deep equality, key order included', () => {
    const parse = strictParser({ type: 'object', properties: { a: { const: { p: 1, q: 2 } } }, required: ['a'] })
    expect(parse({ a: { p: 1, q: 2 } })).toEqual({ a: { p: 1, q: 2 } })
    expect(parse({ a: { q: 2, p: 1 } })).toEqual({ a: { q: 2, p: 1 } })
    expect(() => parse({ a: { p: 1 } })).toThrow()
    expect(() => parse({ a: 'z' })).toThrow()
  })

  it('enforces `const: null` without treating an absent key as a match', () => {
    const parse = strictParser({ type: 'object', properties: { a: { const: null } }, required: ['a'] })
    expect(parse({ a: null })).toEqual({ a: null })
    expect(() => parse({ a: 0 })).toThrow()
    expect(() => parse({})).toThrow(/missing required property/)
  })

  it('coerce mode still repairs a non-const value', () => {
    const parse = coerceParser({ type: 'object', properties: { a: { const: 'x' } }, required: ['a'] })
    expect(parse({ a: 'y' })).toEqual({ a: 'x' })
  })
})

describe('strict parser: minProperties / maxProperties', () => {
  it('enforces both bounds on a root object with no declared properties', () => {
    const parse = strictParser({ type: 'object', minProperties: 2, maxProperties: 3 })
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => parse({ a: 1 })).toThrow(/at least 2 properties/)
    expect(() => parse({ a: 1, b: 2, c: 3, d: 4 })).toThrow(/at most 3 properties/)
  })

  it('enforces them alongside declared properties, past the fast-path guard', () => {
    const parse = strictParser({ type: 'object', properties: { a: { type: 'string' } }, minProperties: 2 })
    expect(parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 })
    expect(() => parse({ a: 'x' })).toThrow(/at least 2 properties/)
  })

  it('enforces them on a nested object property', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { type: 'object', minProperties: 2 } },
      required: ['a'],
    })
    expect(parse({ a: { x: 1, y: 2 } })).toEqual({ a: { x: 1, y: 2 } })
    expect(() => parse({ a: { x: 1 } })).toThrow(/at least 2 properties/)
  })
})

describe('strict parser: required without declared properties', () => {
  it('still demands the key', () => {
    const parse = strictParser({ type: 'object', required: ['a'] })
    expect(parse({ a: 1 })).toEqual({ a: 1 })
    expect(() => parse({})).toThrow(/missing required property 'a'/)
  })
})

describe('strict parser: not', () => {
  it('rejects a value matching the excluded schema at the root', () => {
    const parse = strictParser({ not: { type: 'string' } })
    expect(parse(1)).toBe(1)
    expect(() => parse('x')).toThrow(/must NOT match the excluded schema/)
  })

  it('rejects one on a property, alongside the property type', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { type: 'string', not: { const: 'nope' } } },
      required: ['a'],
    })
    expect(parse({ a: 'ok' })).toEqual({ a: 'ok' })
    expect(() => parse({ a: 'nope' })).toThrow(/must NOT match/)
    expect(() => parse({ a: 1 })).toThrow(/expected string/)
  })

  it('refuses to generate when the excluded subschema cannot be proven inline', () => {
    expect(() => strictParser({ not: { $ref: '#/$defs/x' } })).toThrow(/unsupported keyword "not"/)
  })
})

describe('strict parser: allOf', () => {
  it('enforces constraint-only members at the root', () => {
    const parse = strictParser({ allOf: [{ type: 'number', minimum: 5 }, { multipleOf: 2 }] })
    expect(parse(6)).toBe(6)
    expect(() => parse(5)).toThrow() // odd
    expect(() => parse(4)).toThrow() // below the minimum
    expect(() => parse('x')).toThrow() // not a number
  })

  it('enforces object members of a type-less allOf root', () => {
    const parse = strictParser({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    expect(parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 })
    expect(() => parse({ a: 'x' })).toThrow()
    expect(() => parse({ a: 1, b: 1 })).toThrow()
  })

  it('enforces a constraint-only member on a property', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { allOf: [{ type: 'string' }, { minLength: 3 }] } },
      required: ['a'],
    })
    expect(parse({ a: 'abc' })).toEqual({ a: 'abc' })
    expect(() => parse({ a: 'ab' })).toThrow()
    expect(() => parse({ a: 1 })).toThrow()
  })
})

describe('strict parser: if / then / else', () => {
  it('applies `then` only when `if` matches', () => {
    const parse = strictParser({
      type: 'object',
      properties: { kind: { type: 'string' }, n: { type: 'number' } },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['n'] },
    })
    expect(parse({ kind: 'a', n: 1 })).toEqual({ kind: 'a', n: 1 })
    expect(parse({ kind: 'b' })).toEqual({ kind: 'b' })
    expect(() => parse({ kind: 'a' })).toThrow(/'then' schema/)
  })

  it('applies `else` on the other branch', () => {
    const parse = strictParser({
      type: 'object',
      properties: { kind: { type: 'string' } },
      if: { required: ['kind'] },
      then: { required: ['n'] },
      else: { required: ['m'] },
    })
    expect(parse({ kind: 'a', n: 1 })).toEqual({ kind: 'a', n: 1 })
    expect(parse({ m: 1 })).toEqual({ m: 1 })
    expect(() => parse({})).toThrow(/'else' schema/)
  })
})

describe('strict parser: pattern-matched and additional property values', () => {
  it('enforces a patternProperties value schema', () => {
    const parse = strictParser({ type: 'object', patternProperties: { '^s_': { type: 'string' } } })
    expect(parse({ s_a: 'ok', other: 1 })).toEqual({ s_a: 'ok', other: 1 })
    expect(() => parse({ s_a: 1 })).toThrow(/invalid value for property s_a/)
  })

  it('enforces additionalProperties value constraints beyond the bare type', () => {
    const parse = strictParser({ type: 'object', additionalProperties: { type: 'string', minLength: 3 } })
    expect(parse({ a: 'abc' })).toEqual({ a: 'abc' })
    expect(() => parse({ a: 'ab' })).toThrow(/invalid value for property a/)
  })

  it('exempts keys owned by `properties` or a pattern from the additionalProperties schema', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { type: 'string' } },
      patternProperties: { '^s_': { type: 'boolean' } },
      additionalProperties: { type: 'number' },
    })
    expect(parse({ a: 'x', s_v: true, other: 1 })).toEqual({ a: 'x', s_v: true, other: 1 })
    expect(() => parse({ a: 'x', other: 'nope' })).toThrow(/invalid value for property other/)
  })
})

describe('strict parser: array items beyond scalars', () => {
  it('enforces a nested-array item schema', () => {
    const parse = strictParser({
      type: 'object',
      properties: { g: { type: 'array', items: { type: 'array', items: { type: 'number' } } } },
      required: ['g'],
    })
    expect(parse({ g: [[1, 2]] })).toEqual({ g: [[1, 2]] })
    expect(() => parse({ g: [['x']] })).toThrow()
    expect(() => parse({ g: [1] })).toThrow()
  })

  it('enforces a union item schema', () => {
    const parse = strictParser({ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } })
    expect(parse(['x', 1])).toEqual(['x', 1])
    expect(() => parse([true])).toThrow()
  })

  it('enforces minItems / maxItems on a root array of objects', () => {
    const parse = strictParser({
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: { type: 'object', properties: { a: { type: 'string' } } },
    })
    expect(parse([{ a: 'x' }, { a: 'y' }])).toEqual([{ a: 'x' }, { a: 'y' }])
    expect(() => parse([{ a: 'x' }])).toThrow(/at least 2 items/)
    expect(() => parse([{}, {}, {}, {}])).toThrow(/at most 3 items/)
  })
})

describe('strict parser: nullable object properties', () => {
  it('validates the object shape when the value is not null', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { type: ['object', 'null'], properties: { z: { type: 'string' } }, required: ['z'] } },
      required: ['a'],
    })
    expect(parse({ a: null })).toEqual({ a: null })
    expect(parse({ a: { z: 'x' } })).toEqual({ a: { z: 'x' } })
    expect(() => parse({ a: {} })).toThrow(/declared object shape/)
    expect(() => parse({ a: { z: 1 } })).toThrow(/declared object shape/)
  })
})

describe('boolean property schemas', () => {
  it('carries a `true`-schema value through instead of blanking it', () => {
    const parse = strictParser({ type: 'object', properties: { a: true }, required: ['a'] })
    expect(parse({ a: 1 })).toEqual({ a: 1 })
    expect(() => parse({})).toThrow(/missing required property/)
  })

  it('rejects any value for a `false`-schema property', () => {
    const parse = strictParser({ type: 'object', properties: { a: false } })
    expect(parse({ b: 1 })).toEqual({ b: 1 })
    expect(() => parse({ a: 1 })).toThrow(/must NOT have property 'a'/)
  })
})

describe('strict parser: $ref', () => {
  it('resolves a pointer ref inline when no imported parser enforces it', () => {
    // Single-file generation (no ref imports) has no `parseChild` to delegate to,
    // so the ref has to be proven where it stands.
    const parse = strictParser({
      type: 'object',
      properties: { a: { $ref: '#/$defs/posInt' } },
      $defs: { posInt: { type: 'integer', minimum: 0 } },
    })
    expect(parse({ a: 1 })).toEqual({ a: 1 })
    expect(() => parse({ a: -1 })).toThrow(/referenced schema/)
    expect(() => parse({ a: 'x' })).toThrow(/referenced schema/)
  })

  it('resolves an $anchor ref', () => {
    const parse = strictParser({
      type: 'object',
      properties: { a: { $ref: '#short' } },
      $defs: { shortName: { $anchor: 'short', type: 'string', maxLength: 3 } },
    })
    expect(parse({ a: 'ab' })).toEqual({ a: 'ab' })
    expect(() => parse({ a: 'abcd' })).toThrow(/referenced schema/)
  })

  it('keeps a 2020-12 $ref sibling in force at the root', () => {
    // Draft-07 ignored a `$ref`'s siblings; 2020-12 applies both, and the
    // delegated parser knows nothing about them.
    const parse = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(
        {
          $ref: '#/$defs/base',
          minProperties: 2,
          $defs: { base: { type: 'object', properties: { a: { type: 'string' } } } },
        } as never,
        'Root',
        { strict: true },
      ),
      'parseRoot',
    )
    expect(parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 })
    expect(() => parse({ a: 'x' })).toThrow(/referenced schema/)
  })

  it('enforces allOf $ref members on a property-less object, which delegates nothing', () => {
    const parse = strictParser({
      type: 'object',
      allOf: [{ $ref: '#/$defs/hasA' }, { $ref: '#/$defs/hasB' }],
      $defs: { hasA: { required: ['a'] }, hasB: { required: ['b'] } },
    })
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => parse({ a: 1 })).toThrow()
    expect(() => parse({})).toThrow()
  })

  it('enforces $ref array items when no imported parser validates them', () => {
    const parse = strictParser({
      type: 'array',
      items: { $ref: '#/$defs/pair' },
      $defs: { pair: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } },
    })
    expect(parse([{ a: 1 }])).toEqual([{ a: 1 }])
    expect(() => parse([{ a: 'x' }])).toThrow()
    expect(() => parse([null])).toThrow()
  })
})

describe('strict parser: constraints with nothing to hang them on', () => {
  it('enforces a type-less numeric bound', () => {
    const parse = strictParser({ minimum: 5 })
    expect(parse(6)).toBe(6)
    // JSON Schema applies a numeric bound only to numbers.
    expect(parse('x')).toBe('x')
    expect(() => parse(4)).toThrow()
  })

  it('enforces a type-less required', () => {
    const parse = strictParser({ required: ['a'] })
    expect(parse({ a: 1 })).toEqual({ a: 1 })
    expect(parse('not an object')).toBe('not an object')
    expect(() => parse({})).toThrow()
  })

  it('enforces each branch of a multi-type schema against its own family', () => {
    const parse = strictParser({ type: ['string', 'array'], minLength: 3, minItems: 2 })
    expect(parse('abc')).toBe('abc')
    expect(parse([1, 2])).toEqual([1, 2])
    expect(() => parse('ab')).toThrow()
    expect(() => parse([1])).toThrow()
    expect(() => parse(5)).toThrow()
  })

  it('rejects every value for a `false` schema', () => {
    const parse = strictParser(false)
    expect(() => parse(1)).toThrow(/no value is valid/)
    expect(() => parse({})).toThrow(/no value is valid/)
  })

  it('admits only the empty array for items: false', () => {
    const parse = strictParser({ type: 'array', items: false })
    expect(parse([])).toEqual([])
    expect(() => parse([1])).toThrow()
  })

  it('measures string length in code points, like Ajv', () => {
    const min = strictParser({ type: 'string', minLength: 2 })
    expect(() => min('💩')).toThrow(/at least 2 characters/)
    expect(min('💩💩')).toBe('💩💩')
    const max = strictParser({ type: 'string', maxLength: 2 })
    expect(max('💩💩')).toBe('💩💩')
    expect(() => max('💩💩💩')).toThrow(/at most 2 characters/)
  })

  it('enforces a tuple position beyond its type', () => {
    const parse = strictParser({ type: 'array', prefixItems: [{ type: 'string', maxLength: 2 }] })
    expect(parse(['ab'])).toEqual(['ab'])
    expect(() => parse(['abc'])).toThrow()
  })
})

describe('strict parser: conditionals', () => {
  it('asserts if/then/else instead of building a value from the branches', () => {
    // The coercing conditional path builds its result from the branch fragments,
    // which invented properties the input never had — a strict parser must return
    // exactly what it accepted, or throw.
    const parse = strictParser({
      if: { properties: { a: { const: 1 } }, required: ['a'] },
      then: { required: ['b'] },
      else: { required: ['c'] },
    })
    expect(parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(parse({ c: 3 })).toEqual({ c: 3 })
    expect(() => parse({ a: 1 })).toThrow()
    expect(() => parse({})).toThrow()
  })

  it('accepts null for a nullable object root', () => {
    const parse = strictParser({
      type: ['object', 'null'],
      properties: { a: { type: 'string' } },
      required: ['a'],
    })
    expect(parse(null)).toBeNull()
    expect(parse({ a: 'x' })).toEqual({ a: 'x' })
    expect(() => parse({})).toThrow()
  })
})
