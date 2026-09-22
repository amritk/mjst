import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { collectValidatorImports } from './collect-validator-imports'
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

  it('composes siblings on a $ref that recurses', async () => {
    // A recursive `$ref` produces genuinely cyclic modules, and the sibling
    // checks are emitted next to the delegation inside that cycle. Worth pinning
    // separately: everything else here delegates exactly once.
    const tree = {
      type: 'object',
      properties: { children: { type: 'array', items: { $ref: '#/$defs/node', minProperties: 1 } } },
      $defs: { node: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } } } },
    }
    // The `minProperties: 1` sibling is the whole point: an empty child object
    // satisfies the ref and fails the sibling.
    expect(await linkedVerdicts(tree, { children: [{}] })).toEqual({ generated: false, interpreted: false })
    expect(await linkedVerdicts(tree, { children: [{ children: [] }] })).toEqual({ generated: true, interpreted: true })
    expect(await linkedVerdicts(tree, { children: [] })).toEqual({ generated: true, interpreted: true })
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

  it('reads prefixItems before an array `items` when a node carries both', () => {
    // The type generator and the interpreter both read `prefixItems` first, so
    // reading the draft-07 array `items` first made the validator enforce one
    // tuple while the type emitted beside it described the other — the very
    // type/validator split the draft-07 support exists to close.
    const schema = { type: 'array', items: [{ type: 'string' }], prefixItems: [{ type: 'number' }] }
    expect(generateTypeDefinition(schema as never, 'Root')).toContain('[number?, ...unknown[]]')
    expectAgreement(schema, [1], true)
    expectAgreement(schema, ['a'], false)
  })

  it('lets an empty prefixItems win the positions, and types it that way', () => {
    // The same precedence as the test above, at length 0 — where the *type* used
    // to break it. `prefixItems` being present is what takes the positions, for
    // `tupleShapeOf` and for the interpreter, so an array `items` beside it is
    // read by nobody and the node constrains nothing. `getTuplePositions`
    // required a *non-empty* `prefixItems` and so fell back to that array,
    // emitting `[string?, number?, ...unknown[]]` next to a validator that
    // enforced none of it — a type claiming a shape neither validator holds
    // anyone to, which is the harmful direction for a predicate library.
    const schema = { type: 'array', prefixItems: [], items: [{ type: 'string' }, { type: 'number' }] }
    expect(generateTypeDefinition(schema as never, 'Root')).toContain('unknown[]')
    expect(generateTypeDefinition(schema as never, 'Root')).not.toContain('[string?')
    expectAgreement(schema, ['a', 1], true)
    expectAgreement(schema, [1, 'a'], true)

    // The spellings around it keep their meaning. An empty `prefixItems` beside a
    // schema-form `items` still types every index from 0, and beside `items:
    // false` still forbids every index — and an empty *array* `items`, with no
    // `prefixItems` to displace it, is a draft-07 tuple of no positions, so
    // `additionalItems` is its tail from 0.
    expectAgreement({ type: 'array', prefixItems: [], items: { type: 'string' } }, ['a', 'b'], true)
    expectAgreement({ type: 'array', prefixItems: [], items: { type: 'string' } }, ['a', 1], false)
    expectAgreement({ type: 'array', prefixItems: [], items: false }, [], true)
    expectAgreement({ type: 'array', prefixItems: [], items: false }, [1], false)
    expectAgreement({ type: 'array', items: [], additionalItems: { type: 'string' } }, ['a'], true)
    expectAgreement({ type: 'array', items: [], additionalItems: { type: 'string' } }, [1], false)
  })

  it('collects no import for a $ref in a position the emitter ignores', () => {
    // `additionalItems` is the tail of a *draft-07* tuple, so it means nothing
    // next to a schema-form `items`; `then` means nothing without an `if`. A ref
    // collected from either is a ref no call is emitted for — a dead import under
    // `noUnusedLocals`, or an outright refusal when the walker cannot resolve it.
    const rootSchema = { $defs: { A: {}, S: { type: 'string' } } }
    expect(
      collectValidatorImports(
        { type: 'array', items: { type: 'number' }, additionalItems: { $ref: '#/$defs/S' } } as never,
        {
          rootSchema,
        },
      ),
    ).toEqual([])
    expect(
      collectValidatorImports({ $ref: '#/$defs/A', then: { $ref: '#/$defs/S' } } as never, { rootSchema }),
    ).toEqual(["import { type A, validateA } from './a.js'"])
    // The same refs ARE collected once the emitter really reaches them.
    expect(
      collectValidatorImports(
        { type: 'array', items: [{ type: 'number' }], additionalItems: { $ref: '#/$defs/S' } } as never,
        {
          rootSchema,
        },
      ),
    ).toEqual(["import { type S, validateS } from './s.js'"])
    expect(
      collectValidatorImports({ if: { type: 'string' }, then: { $ref: '#/$defs/S' } } as never, { rootSchema }),
    ).toEqual(["import { type S, validateS } from './s.js'"])
  })

  it('keeps the boolean guard in step with `items: false`', () => {
    // `hasItems` is false for a boolean `items`, so the emptiness rule sailed past
    // the guard while the validator enforced it — `isX([1])` answered `true` for
    // an array schema that admits no elements at all.
    for (const schema of [
      { type: 'array' as const, items: false },
      { type: 'object' as const, properties: { a: { type: 'array' as const, items: false } }, required: ['a'] },
    ]) {
      const exports = evaluateGenerated(
        `${generateValidatorFunction(schema as never, 'Root')}\n\n${generateBooleanGuard(schema as never, 'Root')}`,
      )
      const validateRoot = exports['validateRoot'] as (input: unknown) => unknown
      const isRoot = exports['isRoot'] as (input: unknown) => boolean
      const bad = 'properties' in schema ? { a: [1] } : [1]
      const good = 'properties' in schema ? { a: [] } : []
      expect(validateRoot(bad)).not.toBe(true)
      expect(isRoot(bad)).toBe(false)
      expect(validateRoot(good)).toBe(true)
      expect(isRoot(good)).toBe(true)
    }
  })

  it('folds a combinator branch TypeScript can decide, without moving the verdict', () => {
    // A vacuous `anyOf` branch, or an `if` / `not` whose subschema is `true` or
    // `false`, used to be emitted as a live condition — leaving a body the
    // compiler proves unreachable in output this repo builds with
    // `allowUnreachableCode: false`. Folding is only safe if the verdict does not
    // move, which is what these assert.
    const cases: readonly { schema: unknown; values: readonly [unknown, boolean][] }[] = [
      { schema: { anyOf: [{ type: 'string' }, true] }, values: [[1, true] as const, ['a', true] as const] },
      { schema: { anyOf: [{ type: 'string' }, {}] }, values: [[1, true] as const, ['a', true] as const] },
      {
        schema: { if: true, then: { type: 'string' }, else: { type: 'number' } },
        values: [['a', true] as const, [1, false] as const],
      },
      {
        schema: { if: false, then: { type: 'string' }, else: { type: 'number' } },
        values: [['a', false] as const, [1, true] as const],
      },
      { schema: { not: false }, values: [['a', true] as const, [1, true] as const] },
      { schema: { type: 'string', not: true }, values: [['a', false] as const, [1, false] as const] },
    ]
    for (const { schema, values } of cases) {
      for (const [value, valid] of values) expectAgreement(schema, value, valid)
    }
  })

  it('drops enum members the sibling type rules out', () => {
    // Composing membership onto the guard's `&&` chain put it behind a `typeof`
    // that narrows the accessor, so a member of another type became a comparison
    // TypeScript rejects outright (`TS2367`) — in a file the consumer compiles.
    // Such a member can never match anyway, so it is dropped.
    const guard = generateBooleanGuard({ type: 'integer', enum: [1, 2, 'unlimited'] } as never, 'Root')
    expect(guard).toContain('input === 1')
    expect(guard).toContain('input === 2')
    expect(guard).not.toContain('"unlimited"')

    // The verdicts are what they always were, on both paths.
    for (const [value, valid] of [
      [1, true],
      [2, true],
      ['unlimited', false],
      [3, false],
      [1.5, false],
    ] as const) {
      expectAgreement({ type: 'integer', enum: [1, 2, 'unlimited'] }, value, valid)
    }
    const exports = evaluateGenerated(
      `${generateValidatorFunction({ type: 'integer', enum: [1, 2, 'unlimited'] } as never, 'Root')}\n\n${guard}`,
    )
    const isRoot = exports['isRoot'] as (input: unknown) => boolean
    const validateRoot = exports['validateRoot'] as (input: unknown) => unknown
    for (const value of [1, 2, 3, 1.5, 'unlimited', null]) {
      expect(isRoot(value), `isRoot(${JSON.stringify(value)})`).toBe(validateRoot(value) === true)
    }
  })

  it('does not let additionalItems close a 2020-12 prefixItems tuple', () => {
    // `additionalItems` is not a 2020-12 keyword. Ajv, the interpreter and the
    // tuple type emitted beside the validator all ignore it next to
    // `prefixItems`; capping the length there made the validator the odd one out.
    // Its own dialect still honours it — see the draft-07 case below.
    expectAgreement({ type: 'array', prefixItems: [{ type: 'string' }], additionalItems: false }, ['a', 1], true)
    expectAgreement({ type: 'array', prefixItems: [{ type: 'string' }], additionalItems: false }, [1], false)
    expectAgreement({ type: 'array', items: [{ type: 'string' }], additionalItems: false }, ['a', 1], false)
    expectAgreement({ type: 'array', items: [{ type: 'string' }], additionalItems: false }, ['a'], true)
    // A `prefixItems` tuple closed the 2020-12 way still caps.
    expectAgreement({ type: 'array', prefixItems: [{ type: 'string' }], items: false }, ['a', 1], false)
    expectAgreement({ type: 'array', prefixItems: [{ type: 'string' }], items: false }, ['a'], true)
  })

  it('keeps an always-matching `not` inside its own statement', async () => {
    // Every `errors.push(` becomes `(errors ??= []).push(`, so a report emitted
    // bare at statement position starts with `(` — and after a line that ends in
    // anything but `{` or `}`, ASI fuses the two into a call. Folding
    // `not: {}` / `not: true` to a bare report made
    // `if (_r !== true) (errors ??= []).push(..._r.errors)` swallow the `not`
    // error as an argument, so the schema accepted an instance it forbids.
    const alwaysMatching = [{}, true, { title: 'annotation only' }]
    for (const not of alwaysMatching) {
      const code = generateValidatorFunction({ type: 'object', not } as never, 'Root')
      expect(code).toContain('if (true) {')
      const validateRoot = evaluateValidator(code)
      expect(validateRoot({}), `not: ${JSON.stringify(not)}`).not.toBe(true)
    }
    // The positions where the fusion actually bit, end to end.
    expect(await linkedVerdicts({ $ref: '#/$defs/n', not: {}, $defs: { n: { type: 'number' } } }, 1)).toEqual({
      generated: false,
      interpreted: false,
    })
    expectAgreement({ type: 'array', items: { not: {} } }, [0], false)
    expectAgreement({ type: 'array', items: { not: {} } }, [], true)
    expectAgreement({ type: 'object', not: {} }, {}, false)
    // `not: false` matches nothing, so it is still dropped outright.
    expect(generateValidatorFunction({ type: 'object', not: false } as never, 'Root')).not.toContain(
      'must NOT match the schema in not',
    )
    expectAgreement({ type: 'object', not: false }, {}, true)
  })

  it('fails a tuple position that is a hole', () => {
    // The tail loop reads a sparse hole as `undefined` and rejects it, and the
    // flat guard materialises with `Array.from` for the same reason — but the
    // tuple positions were checked in optional mode, so a hole slipped through.
    const sparse: unknown[] = ['x']
    delete sparse[0]
    for (const schema of [
      { type: 'array', prefixItems: [{ type: 'string' }] },
      { type: 'array', items: [{ type: 'string' }] },
      { type: 'array', prefixItems: [{ const: 'a' }] },
      { type: 'array', prefixItems: [false] },
    ]) {
      expectAgreement(schema, sparse, false)
      expectAgreement(schema, [undefined], false)
    }
    expectAgreement({ type: 'array', prefixItems: [{ type: 'string' }] }, ['a'], true)
    expectAgreement({ type: 'array', items: [{ type: 'string' }] }, ['a'], true)

    // A combinator beneath the position used to re-add the optional guard, so the
    // hole its plain sibling rejected went through here.
    for (const schema of [
      { type: 'array', prefixItems: [{ allOf: [{ type: 'string' }] }] },
      { type: 'array', prefixItems: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }] },
      { type: 'array', prefixItems: [{ if: { type: 'string' }, then: true, else: false }] },
      { type: 'array', items: { allOf: [{ type: 'string' }] } },
    ]) {
      expectAgreement(schema, sparse, false)
      expectAgreement(schema, ['a'], true)
    }
  })

  it('counts contains by index, so a hole is an element like any other', () => {
    // `filter` skips holes, so a sparse array was one element short of what the
    // interpreter counts: it reads the hole as `undefined`, which against
    // `contains: { not: { type: 'string' } }` is the matching item, and against
    // `contains: { type: 'string' }` is not.
    const sparse: unknown[] = ['x', 'y']
    delete sparse[0]

    expectAgreement({ type: 'array', contains: { not: { type: 'string' } } }, sparse, true)
    expectAgreement({ type: 'array', contains: { type: 'string' } }, sparse, true)
    expectAgreement({ type: 'array', contains: { type: 'string' } }, [undefined, undefined], false)
    expectAgreement({ type: 'array', contains: { type: 'string' }, minContains: 2 }, sparse, false)
    expectAgreement({ type: 'array', contains: { type: 'string' }, maxContains: 1 }, ['a', 'b'], false)
    expectAgreement({ type: 'array', contains: { type: 'string' } }, [1, 2], false)
  })

  it('decides a `contains` whose match is constant, without a loop', () => {
    // `contains: true` matches every element, so the count is the array's length;
    // `contains: false` matches none, so it is zero and the bounds are decidable
    // at generation time. Emitting the loop anyway bound an element the folded
    // match never looked at — an unused `const` in the generated file — and
    // reading "no match" as "always invalid" got `{ contains: false, minContains:
    // 0 }` wrong, which every array satisfies.
    const VALUES: readonly unknown[][] = [[], [1], [1, 2], [1, 2, 3]]
    const cases: readonly { schema: Record<string, unknown>; accepted: readonly unknown[][] }[] = [
      // Zero matches is inside [0, 3], so every array passes.
      { schema: { type: 'array', contains: false, minContains: 0, maxContains: 3 }, accepted: VALUES },
      { schema: { type: 'array', contains: false, minContains: 0 }, accepted: VALUES },
      // The default `minContains: 1` no array can reach.
      { schema: { type: 'array', contains: false }, accepted: [] },
      { schema: { type: 'array', contains: false, maxContains: 2 }, accepted: [] },
      // Every element matches, so the count is the length.
      {
        schema: { type: 'array', contains: true, minContains: 2 },
        accepted: [
          [1, 2],
          [1, 2, 3],
        ],
      },
      { schema: { type: 'array', contains: true, minContains: 0, maxContains: 1 }, accepted: [[], [1]] },
      {
        schema: { type: 'array', contains: {}, minContains: 2 },
        accepted: [
          [1, 2],
          [1, 2, 3],
        ],
      },
    ]

    for (const { schema, accepted } of cases) {
      // No loop, so no element binding: a `const` the folded match never reads is
      // `TS6133` in the generated file.
      expect(generateValidatorFunction(schema as never, 'Root')).not.toContain('_ca')
      for (const value of VALUES) {
        expectAgreement(
          schema,
          value,
          accepted.some((entry) => JSON.stringify(entry) === JSON.stringify(value)),
        )
      }
    }
  })

  it('emits nothing for a `minContains: 0` that constrains nothing', () => {
    // Every array satisfies "at least zero matches", empty included, so the whole
    // check is dead — `_cn < 0` is a test no count can fail, and the loop that
    // fed it ran on every call.
    const code = generateValidatorFunction(
      { type: 'array', contains: { type: 'string' }, minContains: 0 } as never,
      'Root',
    )
    expect(code).not.toContain('_cn')
    const validateRoot = evaluateValidator(code)
    expect(validateRoot([])).toBe(true)
    expect(validateRoot([1])).toBe(true)
    // An upper bound still has to be counted for.
    expect(
      generateValidatorFunction({ type: 'array', contains: { type: 'string' }, maxContains: 1 } as never, 'Root'),
    ).toContain('_cn')
  })

  it('tests a declared key without rebuilding an array for every key', () => {
    // The schema-form `additionalProperties` sweep used to open with
    // `["a","b"].includes(_ak0)`, allocating that array on every key of every
    // object validated. `unknownKeyCheck` is what the `additionalProperties:
    // false` sweep beside it already used.
    const code = generateValidatorFunction(
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        additionalProperties: { type: 'number' },
      } as never,
      'Root',
    )

    expect(code).not.toContain('.includes(')
    // The parenthesisation is `unknownKeyCheck`'s, which wraps its chain so it
    // composes as a single term; what matters here is that the test is a chain of
    // comparisons rather than a rebuilt array.
    expect(code).toContain('_pk0 === "a" || _pk0 === "b"')
    expect(code).toContain(') continue')
    const validateRoot = evaluateValidator(code)
    expect(validateRoot({ a: 'x', b: 'y', c: 1 })).toBe(true)
    expect(validateRoot({ a: 'x', c: 'no' })).not.toBe(true)
  })

  it('emits nothing for a `minLength: 0` that constrains nothing', () => {
    // `string-length-check` spells "at least 0 characters" as the literal `false`,
    // which lands as `if (typeof x === 'string' && false)` — a body TypeScript
    // proves unreachable in output the repo compiles with `allowUnreachableCode`
    // off.
    const code = generateValidatorFunction({ type: 'string', minLength: 0 } as never, 'Root')
    expect(code).not.toContain('&& false')
    expect(code).not.toContain('at least 0 characters')
    const validateRoot = evaluateValidator(code)
    expect(validateRoot('')).toBe(true)
    expect(validateRoot('a')).toBe(true)
    expect(validateRoot(1)).not.toBe(true)
    // A real bound is still emitted.
    expect(generateValidatorFunction({ type: 'string', minLength: 1 } as never, 'Root')).toContain(
      'at least 1 characters',
    )
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

  /**
   * The emitter folds branches away; `collectEmittedRefs` decides which `$ref`s
   * still become calls. Those two have to agree, and twice now they have not —
   * once leaving a dead import, once (in the other direction) the risk of a name
   * nothing defines. Reading them side by side is what missed it both times, so
   * this builds schemas that deliberately mix foldable branches with `$ref`-
   * carrying ones, links the whole emitted set, and runs it.
   */
  it('links and runs schemas whose folded branches carry $refs', { timeout: 60_000 }, async () => {
    const rng = ((seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    })(0xf01d)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T

    const defs = { a: { type: 'string' }, b: { type: 'number' }, c: { minLength: 2 } }
    // Everything the emitter treats as "matches everything", so the branch — and
    // in an `anyOf`, the whole keyword — disappears.
    const foldable: readonly unknown[] = [true, {}, { title: 'x' }, { $comment: 'z' }, { default: 1 }]
    const reffy = (): unknown => ({ $ref: `#/$defs/${pick(['a', 'b', 'c'])}` })
    const real: readonly (() => unknown)[] = [
      reffy,
      () => ({ not: reffy() }),
      () => ({ allOf: [reffy()] }),
      () => false,
    ]
    const branch = (): unknown => (rng() < 0.45 ? pick(foldable) : pick(real)())

    const shapes: readonly (() => Record<string, unknown>)[] = [
      () => ({ anyOf: [branch(), branch()] }),
      () => ({ oneOf: [branch(), branch()] }),
      () => ({ allOf: [branch(), branch()] }),
      () => ({ if: branch(), then: branch(), else: branch() }),
      () => ({ if: branch(), then: branch() }),
      () => ({ if: branch(), else: branch() }),
      () => ({ type: 'object', properties: { p: { anyOf: [branch(), branch()] } } }),
      () => ({ type: 'array', items: { if: branch(), then: branch(), else: branch() } }),
    ]
    const values: readonly unknown[] = ['a', 'abc', 1, true, null, [], [1], {}, { p: 'x' }]

    const failures: string[] = []
    for (let i = 0; i < 250 && failures.length < 5; i++) {
      const schema = { ...pick(shapes)(), $defs: defs }
      const files = await buildValidatorSchema(schema as never, 'Root')
      // A missing import surfaces here, as a module that will not link or a name
      // that is not defined when the validator runs.
      const generated = linkGenerated<(input: unknown) => unknown>(files, 'index', 'validateRoot')
      const interpret = validate(schema as never)
      for (const value of values) {
        let ours: boolean | string
        try {
          ours = generated(value) === true
        } catch (error) {
          ours = `threw:${(error as Error).message}`
        }
        const theirs = interpret(value) === true
        if (ours !== theirs) {
          failures.push(`${JSON.stringify(schema)} on ${JSON.stringify(value)} → ours=${ours} interpreter=${theirs}`)
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
