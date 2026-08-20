import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser } from './differential.test-utils'

/**
 * A strict parser promises to throw on every document its schema rejects. These
 * are the shapes where it silently did not, each one reduced from a differential
 * fuzz run against Ajv:
 *
 *  - a nested object property whose own `properties` / `required` were enforced
 *    only by the private sub-parser the parent synthesizes — which a sibling
 *    keyword (`allOf`, `not`, `if`, `patternProperties`, a schema-valued
 *    `additionalProperties`, a union) suppresses, and which the pattern-property
 *    parsers never emit at all;
 *  - a fast-path guard that reported "already in shape" for a value the schema
 *    rejects, so the parser returned before its own assertions ran;
 *  - `additionalProperties: false` switched off by a sibling composition keyword,
 *    though 2020-12 answers it against this schema object's own `properties`;
 *  - a scalar `items` schema whose constraints (`minLength`, `minimum`, …) were
 *    dropped in favour of a bare `typeof` test.
 *
 * Each case is asserted against Ajv rather than against a hand-written verdict,
 * so the expectations cannot drift from the specification.
 */
const ajv = new Ajv({ strict: false, ownProperties: true })

const parserFor = (schema: JSONSchema): ((input: unknown) => unknown) =>
  evalGenerated<(input: unknown) => unknown>(generateFileParser(schema, 'Root', { strict: true }), 'parseRoot')

/** Asserts the generated strict parser accepts exactly what Ajv accepts, unchanged. */
const agreesWithAjv = (schema: JSONSchema, input: unknown): void => {
  const valid = ajv.compile(structuredClone(schema) as object)(structuredClone(input))
  const parse = parserFor(schema)
  let output: unknown
  let threw = false
  try {
    output = parse(structuredClone(input))
  } catch {
    threw = true
  }
  expect(threw, `${valid ? 'rejected a valid' : 'accepted an invalid'} value: ${JSON.stringify(input)}`).toBe(!valid)
  if (!threw) {
    expect(isDeepStrictEqual(output, input), `changed an accepted value: ${JSON.stringify(output)}`).toBe(true)
  }
}

/** `{ c: <inner> }`, the wrapper that makes `inner` a *nested* property. */
const wrap = (inner: Record<string, unknown>): JSONSchema =>
  ({ type: 'object', properties: { c: inner }, required: ['c'] }) as JSONSchema

const innerWith = (extra: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties: { a: { type: 'number' } },
  required: ['a'],
  ...extra,
})

describe('strict assertions for a nested object property with no sub-parser', () => {
  const siblings: [string, Record<string, unknown>][] = [
    ['a schema-valued additionalProperties', { additionalProperties: { type: 'string' } }],
    ['patternProperties', { patternProperties: { '^x-': { type: 'string' } } }],
    ['allOf', { allOf: [{ type: 'object' }] }],
    ['not', { not: { type: 'string' } }],
    ['if/then', { if: { type: 'object' }, then: { type: 'object' } }],
    ['oneOf', { oneOf: [{ type: 'object' }, { type: 'array' }] }],
    ['anyOf', { anyOf: [{ type: 'object' }] }],
  ]

  for (const [label, extra] of siblings) {
    it(`enforces required through ${label}`, () => {
      agreesWithAjv(wrap(innerWith(extra)), { c: {} })
    })

    it(`enforces property types through ${label}`, () => {
      agreesWithAjv(wrap(innerWith(extra)), { c: { a: 'not a number' } })
    })

    it(`still accepts a valid value through ${label}`, () => {
      agreesWithAjv(wrap(innerWith(extra)), { c: { a: 1 } })
    })
  }

  it('enforces required on a nested object that declares no properties', () => {
    agreesWithAjv(wrap({ type: 'object', required: ['a'] }), { c: {} })
  })

  it('enforces a nested additionalProperties: false alongside patternProperties', () => {
    const schema = wrap({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
      patternProperties: { '^x-': { type: 'string' } },
    })
    agreesWithAjv(schema, { c: { a: 'x', zz: 1 } })
    agreesWithAjv(schema, { c: { a: 'x', 'x-q': 's' } })
  })

  it('enforces a nested object property under a pattern-property parser', () => {
    // properties + patternProperties + additionalProperties: false routes to the
    // combined parser, which builds its result with a copy loop and emits no
    // sub-parsers — so these assertions are the only enforcement there is.
    const schema = {
      type: 'object',
      properties: { c: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } },
      required: ['c'],
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: false,
    } as JSONSchema
    agreesWithAjv(schema, { c: {} })
    agreesWithAjv(schema, { c: { a: 'no' } })
    agreesWithAjv(schema, { c: { a: 1 }, 'x-q': 's' })
  })

  it('enforces array items under a pattern-property parser', () => {
    const schema = {
      type: 'object',
      properties: {
        c: { type: 'array', items: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } },
      },
      required: ['c'],
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: false,
    } as JSONSchema
    agreesWithAjv(schema, { c: [{}] })
    agreesWithAjv(schema, { c: [{ a: 1 }] })
  })
})

describe('additionalProperties: false is not switched off by composition', () => {
  for (const [label, extra] of [
    ['allOf', { allOf: [{ type: 'object' }] }],
    ['oneOf', { oneOf: [{ type: 'object' }, { type: 'array' }] }],
    ['anyOf', { anyOf: [{ type: 'object' }] }],
  ] as [string, Record<string, unknown>][]) {
    it(`rejects an undeclared key alongside ${label}`, () => {
      const schema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
        ...extra,
      } as JSONSchema
      agreesWithAjv(schema, { a: 'x', zz: 1 })
      agreesWithAjv(schema, { a: 'x' })
    })
  }

  it("rejects a key an allOf member declares — additionalProperties reads this schema's own properties", () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
      allOf: [{ properties: { b: { type: 'string' } } }],
    } as JSONSchema
    agreesWithAjv(schema, { a: 'x', b: 'y' })
  })
})

describe('scalar item constraints', () => {
  it('enforces minLength on string items', () => {
    const schema = wrap({ type: 'array', items: { type: 'string', minLength: 1 } })
    agreesWithAjv(schema, { c: [''] })
    agreesWithAjv(schema, { c: ['a'] })
  })

  it('enforces minimum on number items', () => {
    agreesWithAjv(wrap({ type: 'array', items: { type: 'number', minimum: 5 } }), { c: [1] })
  })

  it('enforces pattern on the items of a root array', () => {
    agreesWithAjv({ type: 'array', items: { type: 'string', pattern: '^[a-z]+$' } } as JSONSchema, ['ABC'])
  })
})

describe('union branches over a multi-type or null schema', () => {
  const schema = {
    type: 'object',
    properties: { v: { anyOf: [{ type: ['string', 'null'] }, { type: 'boolean' }] } },
    additionalProperties: false,
    patternProperties: { '^x-': { type: 'string' } },
  } as JSONSchema

  it('keeps a null that the array-form type branch admits', () => {
    agreesWithAjv(schema, { v: null })
  })

  it('keeps a string that the array-form type branch admits', () => {
    agreesWithAjv(schema, { v: 'hello' })
  })

  it('rejects a value no branch admits', () => {
    agreesWithAjv(schema, { v: 5 })
  })

  it('keeps a null admitted by a plain null branch', () => {
    agreesWithAjv(
      { type: 'object', properties: { v: { anyOf: [{ type: 'string' }, { type: 'null' }] } } } as JSONSchema,
      { v: null },
    )
  })
})

describe('optional properties are never conjured', () => {
  for (const [label, inner] of [
    ['allOf', { allOf: [{ type: 'object' }] }],
    ['not', { not: { type: 'string' } }],
    ['no type at all', { description: 'anything' }],
  ] as [string, Record<string, unknown>][]) {
    it(`leaves an absent optional property absent with ${label}`, () => {
      // The pattern-property parser builds its result from the coercing
      // property expressions, so an expression that fell back to the schema
      // default for an *absent* key added a property the input never had — in a
      // strict parser, which must return the value it accepted.
      const schema = {
        type: 'object',
        properties: { keep: { type: 'string' }, opt: inner },
        required: ['keep'],
        additionalProperties: false,
        patternProperties: { '^x-': { type: 'string' } },
      } as JSONSchema
      agreesWithAjv(schema, { keep: 'v' })
    })
  }
})
