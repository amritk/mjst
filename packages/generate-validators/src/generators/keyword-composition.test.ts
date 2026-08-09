import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { evaluateGenerated, evaluateValidator } from './evaluate-generated.test-utils'
import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'
import { linkGenerated } from './link-generated.test-utils'

/**
 * Every keyword in a schema object is an independent assertion the instance has
 * to satisfy. The emitter used to be a chain of `if (keyword) { emit; return }`,
 * so the first keyword it recognised swallowed the rest — `{"type":"string",
 * "const":1}` accepted `1`, `{"$ref":"…","minLength":3}` accepted `"q"`, and a
 * draft-07 tuple emitted no array validation at all while the type generator
 * wrote out a real tuple type.
 *
 * The conformance suite could not catch the first of those: it never pairs
 * `enum`/`const` with a sibling validation keyword, so it was green throughout.
 * These tests pin the composition directly, in every position the emitter has a
 * separate code path for, and hold each verdict against
 * `@amritk/runtime-validators` — the interpreter is the reference implementation
 * of the same schema language, so agreeing with it is the contract.
 *
 * Each case asserts *both* directions on purpose. A test that only checked the
 * previously-accepted bad value would pass just as well for a validator that
 * rejects everything, so every case also names an instance that must still be
 * accepted.
 */

/** Runs a single-file schema through the generator and the interpreter. */
const verdicts = (schema: unknown, value: unknown): { generated: boolean; interpreted: boolean } => {
  const generated = evaluateValidator(generateValidatorFunction(schema as never, 'Root'))
  return { generated: generated(value) === true, interpreted: validate(schema as never)(value) === true }
}

/** The same, for a schema whose `$ref`s need the whole emitted file set linked. */
const linkedVerdicts = async (
  schema: unknown,
  value: unknown,
): Promise<{ generated: boolean; interpreted: boolean }> => {
  const files = await buildValidatorSchema(schema as never, 'Root')
  const generated = linkGenerated<(input: unknown) => unknown>(files, 'index', 'validateRoot')
  return { generated: generated(value) === true, interpreted: validate(schema as never)(value) === true }
}

const expectAgreement = (schema: unknown, value: unknown, valid: boolean): void => {
  const { generated, interpreted } = verdicts(schema, value)
  expect(interpreted, `interpreter oracle for ${JSON.stringify(value)}`).toBe(valid)
  expect(generated, `generated validator for ${JSON.stringify(value)}`).toBe(valid)
}

/**
 * A `const` paired with a sibling the `const` alone cannot satisfy, in every
 * position the emitter dispatches separately. The rejected value is the one the
 * old early-return accepted — it satisfies the `const` and fails the sibling —
 * and the accepted value next to it proves the position still validates rather
 * than rejecting outright.
 */
type Case = { schema: unknown; value: unknown; valid: boolean }
const CONST_SIBLING_POSITIONS: readonly { where: string; cases: readonly Case[] }[] = [
  {
    where: 'root',
    cases: [
      { schema: { type: 'string', const: 1 }, value: 1, valid: false },
      { schema: { type: 'string', const: 'a' }, value: 'a', valid: true },
    ],
  },
  {
    where: 'required property',
    cases: [
      {
        schema: { type: 'object', properties: { a: { type: 'string', const: 1 } }, required: ['a'] },
        value: { a: 1 },
        valid: false,
      },
      {
        schema: { type: 'object', properties: { a: { type: 'string', const: 'a' } }, required: ['a'] },
        value: { a: 'a' },
        valid: true,
      },
    ],
  },
  {
    where: 'optional property',
    cases: [
      { schema: { type: 'object', properties: { a: { type: 'string', const: 1 } } }, value: { a: 1 }, valid: false },
      { schema: { type: 'object', properties: { a: { type: 'string', const: 1 } } }, value: {}, valid: true },
    ],
  },
  {
    where: 'items',
    cases: [
      { schema: { type: 'array', items: { type: 'string', const: 1 } }, value: [1], valid: false },
      { schema: { type: 'array', items: { type: 'string', const: 1 } }, value: [], valid: true },
    ],
  },
  {
    where: 'prefixItems',
    cases: [
      { schema: { type: 'array', prefixItems: [{ type: 'string', const: 1 }] }, value: [1], valid: false },
      { schema: { type: 'array', prefixItems: [{ type: 'string', const: 1 }] }, value: [], valid: true },
    ],
  },
  {
    where: 'contains',
    cases: [
      { schema: { type: 'array', contains: { type: 'string', const: 1 } }, value: [1], valid: false },
      { schema: { type: 'array', contains: { type: 'string', const: 'a' } }, value: ['a'], valid: true },
    ],
  },
  {
    where: 'additionalProperties',
    cases: [
      { schema: { type: 'object', additionalProperties: { type: 'string', const: 1 } }, value: { z: 1 }, valid: false },
      { schema: { type: 'object', additionalProperties: { type: 'string', const: 1 } }, value: {}, valid: true },
    ],
  },
  {
    where: 'patternProperties',
    cases: [
      {
        schema: { type: 'object', patternProperties: { '^z': { type: 'string', const: 1 } } },
        value: { z: 1 },
        valid: false,
      },
      {
        schema: { type: 'object', patternProperties: { '^z': { type: 'string', const: 1 } } },
        value: { q: 1 },
        valid: true,
      },
    ],
  },
  {
    where: 'propertyNames',
    cases: [
      { schema: { type: 'object', propertyNames: { const: 'a', minLength: 5 } }, value: { a: 1 }, valid: false },
      { schema: { type: 'object', propertyNames: { const: 'abcde', minLength: 5 } }, value: { abcde: 1 }, valid: true },
    ],
  },
  {
    where: 'dependentSchemas',
    cases: [
      // The subschema applies to the whole object, so the sibling has to be one
      // that also reads the object: `minProperties` next to a matching `const`.
      {
        schema: { type: 'object', dependentSchemas: { t: { const: { t: 1 }, minProperties: 2 } } },
        value: { t: 1 },
        valid: false,
      },
      {
        schema: { type: 'object', dependentSchemas: { t: { const: { t: 1, u: 2 }, minProperties: 2 } } },
        value: { t: 1, u: 2 },
        valid: true,
      },
    ],
  },
  {
    where: 'not',
    cases: [
      // The other direction: dropping the sibling made the inner schema broader,
      // so `1` matched it and the `not` wrongly rejected.
      { schema: { not: { type: 'string', const: 1 } }, value: 1, valid: true },
      { schema: { not: { type: 'string', const: 'a' } }, value: 'a', valid: false },
    ],
  },
  {
    where: 'allOf',
    cases: [
      { schema: { allOf: [{ type: 'string', const: 1 }] }, value: 1, valid: false },
      { schema: { allOf: [{ type: 'string', const: 'a' }] }, value: 'a', valid: true },
    ],
  },
  {
    where: 'if/then',
    cases: [
      { schema: { if: { type: 'string' }, then: { const: 'a', minLength: 3 } }, value: 'a', valid: false },
      { schema: { if: { type: 'string' }, then: { const: 'abc', minLength: 3 } }, value: 'abc', valid: true },
    ],
  },
  {
    where: 'if/else',
    cases: [
      { schema: { if: { type: 'string' }, else: { const: 1, minimum: 3 } }, value: 1, valid: false },
      { schema: { if: { type: 'string' }, else: { const: 5, minimum: 3 } }, value: 5, valid: true },
    ],
  },
]

describe('keyword-composition', () => {
  for (const { where, cases } of CONST_SIBLING_POSITIONS) {
    it(`enforces a const and its sibling keyword together under ${where}`, () => {
      for (const { schema, value, valid } of cases) expectAgreement(schema, value, valid)
    })
  }

  it('enforces an enum and its sibling type together', () => {
    const schema = { type: 'object', properties: { a: { enum: [1, 'ok'], type: 'string' } } }
    // `1` is in the enum and is not a string, so only the composed pair rejects it.
    expectAgreement(schema, { a: 1 }, false)
    expectAgreement(schema, { a: 'ok' }, true)
    // The enum still bites on its own: `"no"` is a string outside the members.
    expectAgreement(schema, { a: 'no' }, false)
  })

  it('enforces an enum and a sibling minLength together', () => {
    const schema = { enum: ['ab', 'abcd'], minLength: 3 }
    expectAgreement(schema, 'ab', false)
    expectAgreement(schema, 'abcd', true)
  })

  it('keeps the boolean guard in step with an enum that has constraining siblings', () => {
    // `isX` used to answer with the bare membership test, so it accepted a value
    // `validateX` rejects — the one direction a guard must never be wrong in.
    const schema = { enum: [1, 'ok'], type: 'string' as const }
    const exports = evaluateGenerated(
      `${generateValidatorFunction(schema as never, 'Root')}\n\n${generateBooleanGuard(schema as never, 'Root')}`,
    )
    const validateRoot = exports['validateRoot'] as (input: unknown) => unknown
    const isRoot = exports['isRoot'] as (input: unknown) => boolean
    for (const value of [1, 'ok', 'no', null, {}]) {
      expect(isRoot(value), `isRoot(${JSON.stringify(value)})`).toBe(validateRoot(value) === true)
    }
    expect(isRoot('ok')).toBe(true)
    expect(isRoot(1)).toBe(false)
  })

  it('keeps the flat guard for an enum with an expressible sibling', () => {
    // `{ "type": "string", "enum": [...] }` is the commonest shape in an OpenAPI
    // document — a discriminator — and both halves of it are expressible flat, so
    // the guard has to compose them rather than fall back to calling `validateX`.
    // Bailing here is correct but cost 394 of the 982 real-world corpus schemas
    // their inline guard.
    const guard = generateBooleanGuard({ type: 'string', enum: ['a', 'b'] } as never, 'Root')
    expect(guard).not.toContain('validateRoot(input) === true')
    expect(guard).toContain("typeof input === 'string'")
    expect(guard).toContain('input === "a"')

    const exports = evaluateGenerated(
      `${generateValidatorFunction({ type: 'string', enum: ['a', 'b'] } as never, 'Root')}\n\n${guard}`,
    )
    const isRoot = exports['isRoot'] as (input: unknown) => boolean
    const validateRoot = exports['validateRoot'] as (input: unknown) => unknown
    for (const value of ['a', 'b', 'c', 1, null]) {
      expect(isRoot(value), `isRoot(${JSON.stringify(value)})`).toBe(validateRoot(value) === true)
    }
    expect(isRoot('a')).toBe(true)
    expect(isRoot('c')).toBe(false)
  })

  it('applies a top-level $ref and its siblings to the same value', async () => {
    const schema = { $ref: '#/$defs/s', minLength: 3, $defs: { s: { type: 'string' } } }
    // The delegation alone accepted `"q"`; the sibling alone would accept `7`.
    // Both have to run, which is what 2020-12 says and what this file's own
    // comment on the property path already claimed.
    expect(await linkedVerdicts(schema, 'q')).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(schema, 7)).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(schema, 'qqq')).toEqual({ generated: true, interpreted: true })
  })

  it('applies $ref siblings in positions other than properties', async () => {
    const defs = { s: { type: 'string' } }
    // `not` is the direction that shows the bug cuts both ways: dropping the
    // sibling made the inner schema *broader*, so the `not` wrongly rejected.
    const inNot = { not: { $ref: '#/$defs/s', minLength: 3 }, $defs: defs }
    expect(await linkedVerdicts(inNot, 'a')).toEqual({ generated: true, interpreted: true })
    expect(await linkedVerdicts(inNot, 'abc')).toEqual({ generated: false, interpreted: false })

    const inItems = { type: 'array', items: { $ref: '#/$defs/s', minLength: 3 }, $defs: defs }
    expect(await linkedVerdicts(inItems, ['a'])).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(inItems, ['abc'])).toEqual({ generated: true, interpreted: true })

    const inAdditional = { type: 'object', additionalProperties: { $ref: '#/$defs/s', minLength: 3 }, $defs: defs }
    expect(await linkedVerdicts(inAdditional, { z: 'a' })).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(inAdditional, { z: 'abc' })).toEqual({ generated: true, interpreted: true })
  })

  it('applies a $ref alongside a type sibling in a property', async () => {
    // A `$ref` to a string and a `type: "number"` sibling is unsatisfiable, and
    // the property path dropped the `type` half.
    const schema = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/s', type: 'number' } },
      $defs: { s: { type: 'string' } },
    }
    expect(await linkedVerdicts(schema, { a: 'x' })).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(schema, { a: 1 })).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(schema, {})).toEqual({ generated: true, interpreted: true })
  })

  it('imports the validator for a $ref that sits beside another $ref', async () => {
    // With siblings emitted, one node can produce two `validateX(...)` calls. The
    // import collector treated a `$ref` as a leaf, so the second call compiled to
    // an undefined identifier.
    const schema = {
      $ref: '#/$defs/s',
      allOf: [{ $ref: '#/$defs/long' }],
      $defs: { s: { type: 'string' }, long: { minLength: 3 } },
    }
    expect(await linkedVerdicts(schema, 'q')).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(schema, 'qqq')).toEqual({ generated: true, interpreted: true })
  })

  it('validates a draft-07 tuple written as an array `items`', () => {
    // `items: [...]` is the tuple itself in draft-07 (2020-12 spells it
    // `prefixItems`). The generator read only the 2020-12 spelling, so this
    // emitted no array validation at all — while the type generator emitted a
    // real tuple type, leaving the two contradicting each other.
    const schema = { type: 'array', items: [{ type: 'string' }, { type: 'number' }] }
    expectAgreement(schema, ['a', 1], true)
    expectAgreement(schema, [1, 'a'], false)
    expectAgreement(schema, ['a'], true)
    // No `additionalItems`, so the tail is unconstrained and extras are fine.
    expectAgreement(schema, ['a', 1, true], true)
  })

  it('applies additionalItems as the tail of a draft-07 tuple', () => {
    const typed = { type: 'array', items: [{ type: 'string' }], additionalItems: { type: 'number' } }
    expectAgreement(typed, ['a', 1, 2], true)
    expectAgreement(typed, ['a', 'b'], false)

    const closed = { type: 'array', items: [{ type: 'string' }], additionalItems: false }
    expectAgreement(closed, ['a'], true)
    expectAgreement(closed, ['a', 1], false)
  })

  it('keeps the boolean guard in step with a draft-07 tuple', () => {
    // `booleanArrayExpr` read `items` as a tail schema, saw an array, and emitted
    // no per-item test — so `isX` accepted tuples `validateX` rejects.
    const schema = { type: 'array' as const, items: [{ type: 'string' as const }, { type: 'number' as const }] }
    const exports = evaluateGenerated(
      `${generateValidatorFunction(schema as never, 'Root')}\n\n${generateBooleanGuard(schema as never, 'Root')}`,
    )
    const validateRoot = exports['validateRoot'] as (input: unknown) => unknown
    const isRoot = exports['isRoot'] as (input: unknown) => boolean
    for (const value of [['a', 1], [1, 'a'], ['a'], [], 'x']) {
      expect(isRoot(value), `isRoot(${JSON.stringify(value)})`).toBe(validateRoot(value) === true)
    }
    expect(isRoot(['a', 1])).toBe(true)
    expect(isRoot([1, 'a'])).toBe(false)
  })

  it('escapes a runtime key into its error path', () => {
    // Static keys already went through the generation-time escape; keys read at
    // runtime did not, so `{"a/b": 1}` reported `/a/b` — which reads back as the
    // child `b` of a property `a`, a different location entirely.
    const cases: readonly { schema: unknown; value: unknown; path: string }[] = [
      { schema: { type: 'object', additionalProperties: false }, value: { 'a/b': 1 }, path: '/a~1b' },
      { schema: { type: 'object', additionalProperties: { type: 'string' } }, value: { 'a/b': 1 }, path: '/a~1b' },
      {
        schema: { type: 'object', patternProperties: { '^a': { type: 'string' } } },
        value: { 'a/b': 1 },
        path: '/a~1b',
      },
      { schema: { type: 'object', propertyNames: { maxLength: 1 } }, value: { 'a~b': 1 }, path: '/a~0b' },
    ]
    for (const { schema, value, path } of cases) {
      const generated = evaluateValidator(generateValidatorFunction(schema as never, 'Root'))
      const result = generated(value) as { valid: false; errors: { path: string }[] }
      expect(result, `${JSON.stringify(schema)} should reject`).not.toBe(true)
      expect(result.errors.map((error) => error.path)).toContain(path)

      // And the interpreter, which is where the escaping convention comes from.
      const interpreted = validate(schema as never)(value)
      expect(interpreted).not.toBe(true)
      expect((interpreted as { errors: { path: string }[] }).errors.map((error) => error.path)).toContain(path)
    }
  })

  it('leaves an ordinary runtime key unescaped', () => {
    // The escape has to be a no-op for the common key, or every path grows a
    // wrapper for nothing.
    const generated = evaluateValidator(
      generateValidatorFunction({ type: 'object', additionalProperties: false } as never, 'Root'),
    )
    const result = generated({ plain: 1 }) as { valid: false; errors: { path: string }[] }
    expect(result).not.toBe(true)
    expect(result.errors.map((error) => error.path)).toEqual(['/plain'])
  })
})
