import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser } from './differential.test-utils'

/**
 * Pins the Draft 2020-12 semantics where the strict parser used to disagree with
 * Ajv — and, more awkwardly, with `generate-validators`, mjst's own other engine
 * for the same schemas. Each case is the exact schema/value pair that diverged:
 *
 *  - `items` alongside `prefixItems` is the *tail* schema, not a per-element one.
 *  - `enum` / `const` compare structurally; `.includes` is reference equality for
 *    objects and `JSON.stringify` is key-order sensitive.
 *  - `uniqueItems` compares items structurally, for the same reason.
 *  - `oneOf` means exactly one branch, not at least one.
 *
 * Ajv is the oracle throughout: the accept/reject verdict is the whole contract
 * of a strict parser, so "generated parser threw iff Ajv rejected" is the
 * assertion, run through the real generated code rather than its source text.
 * Parsers are built the way `generate-files` lays a file out (shape validator
 * first, then the parser handed that validator's source) so the fast path is
 * exercised too — several of these bugs lived there rather than in the
 * assertions.
 */
const ajv = new Ajv({ strict: false, allErrors: false })

/** Asserts the strict parser throws exactly when Ajv rejects, for every value. */
const expectAjvParity = (schema: unknown, values: readonly unknown[]): void => {
  const parse = evalGenerated<(input: unknown) => unknown>(
    generateFileParser(schema as never, 'Doc', { strict: true }),
    'parseDoc',
  )
  const check = ajv.compile(schema as object)
  for (const value of values) {
    const valid = check(value) === true
    let threw = false
    try {
      parse(structuredClone(value))
    } catch {
      threw = true
    }
    expect(threw, `${JSON.stringify(schema)} on ${JSON.stringify(value)} — ajv ${valid ? 'accepts' : 'rejects'}`).toBe(
      !valid,
    )
  }
}

describe('strict-structural-conformance', () => {
  it('applies `items` only to the elements past `prefixItems`', () => {
    // `["a", 1, 2]`: index 0 answers to `prefixItems` alone. Checking the tail
    // schema from index 0 made the strict parser throw on a value Ajv accepts —
    // and one the emitted `[string?, ...number[]]` type already admits.
    expectAjvParity(
      {
        type: 'object',
        properties: { t: { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } } },
      },
      [{ t: ['a', 1, 2] }, { t: ['a'] }, { t: [] }, { t: [1, 1, 2] }, { t: ['a', 'b'] }, { t: ['a', 1, 'c'] }],
    )
  })

  it('applies `items` only past `prefixItems` at the root too', () => {
    expectAjvParity({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } }, [
      ['a', 1, 2],
      ['a'],
      [],
      [1, 1, 2],
      ['a', 'b'],
    ])
  })

  it('matches an object or array enum member structurally', () => {
    expectAjvParity({ type: 'object', properties: { e: { enum: [{ a: 1 }, ['b'], 'c'] } }, required: ['e'] }, [
      { e: { a: 1 } },
      { e: ['b'] },
      { e: 'c' },
      { e: { a: 2 } },
      { e: { a: 1, b: 2 } },
      { e: [] },
    ])
  })

  it('matches an object enum member structurally at the root', () => {
    expectAjvParity({ enum: [{ a: 1 }, 'x'] }, [{ a: 1 }, 'x', { a: 2 }, {}])
  })

  it('compares a structural `const` independently of key order', () => {
    // `JSON.stringify(input) !== '{"a":1,"b":2}'` rejected a reordered-but-equal
    // object, and serialized the whole value on every call to do it.
    expectAjvParity({ const: { a: 1, b: 2 } }, [
      { a: 1, b: 2 },
      JSON.parse('{"b":2,"a":1}'),
      { a: 1 },
      { a: 1, b: 2, c: 3 },
      'nope',
    ])
  })

  it('compares a nested structural `const` independently of key order', () => {
    expectAjvParity({ const: { a: [1, { x: 1, y: 2 }] } }, [
      { a: [1, { x: 1, y: 2 }] },
      JSON.parse('{"a":[1,{"y":2,"x":1}]}'),
      { a: [1, { x: 1 }] },
      { a: [1] },
    ])
  })

  it('dedupes uniqueItems structurally on an object-item property', () => {
    expectAjvParity(
      {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            uniqueItems: true,
            items: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
          },
        },
      },
      [
        { rows: [{ a: 1, b: 2 }, JSON.parse('{"b":2,"a":1}')] },
        {
          rows: [
            { a: 1, b: 2 },
            { a: 1, b: 3 },
          ],
        },
        { rows: [] },
        { rows: [{ a: 1 }] },
      ],
    )
  })

  it('dedupes uniqueItems structurally on a root array of objects', () => {
    // This shape skipped the constraint entirely: the root array-of-objects
    // parser delegates every element and bypassed the array-level assertions.
    expectAjvParity(
      {
        type: 'array',
        uniqueItems: true,
        items: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      },
      [
        [{ a: 1, b: 2 }, JSON.parse('{"b":2,"a":1}')],
        [
          { a: 1, b: 2 },
          { a: 1, b: 3 },
        ],
        [],
      ],
    )
  })

  it('keeps the cheap Set dedupe correct for scalar items', () => {
    expectAjvParity({ type: 'array', uniqueItems: true, items: { type: 'string' } }, [['a', 'a'], ['a', 'b'], []])
  })

  it('enforces oneOf exclusivity', () => {
    // `{ a: 'x', b: 1 }` matches both branches, so `oneOf` rejects it. Both
    // branches were folded into a plain disjunction, which accepted it — while
    // `generate-validators` rejected it, so the two engines split on one contract.
    expectAjvParity(
      {
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
      [{ a: 'x', b: 1 }, { a: 'x' }, { b: 1 }, { c: 1 }, {}],
    )
  })

  it('leaves anyOf inclusive', () => {
    // The mirror image: `anyOf` must still accept a value matching two branches.
    expectAjvParity(
      {
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
      [{ a: 'x', b: 1 }, { a: 'x' }, { b: 1 }, { c: 1 }],
    )
  })

  it('enforces oneOf exclusivity on a property', () => {
    expectAjvParity(
      {
        type: 'object',
        required: ['v'],
        properties: {
          v: {
            oneOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
            ],
          },
        },
      },
      [{ v: { a: 'x', b: 1 } }, { v: { a: 'x' } }, { v: { b: 1 } }, { v: {} }],
    )
  })
})
