import Ajv2020 from 'ajv/dist/2020'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { VALIDATION_RESULT_CONTENT } from './build-schema'
import { evaluateGenerated } from './evaluate-generated.test-utils'
import { generateCoerceFunction } from './generate-coerce-function'
import { generateValidatorFunction } from './generate-validator-function'

/**
 * Differential fuzz for `--coerce`, with Ajv compiled `{ allErrors: true,
 * coerceTypes: true }` as the oracle — the exact configuration the feature
 * exists to replace.
 *
 * Two things have to match, not one. The verdict, as everywhere else in this
 * package; and the *value*, because a coercing validator that agrees on
 * accept/reject while producing a different number is worse than one that
 * disagrees loudly. Ajv coerces in place, so the oracle is run against a clone
 * and the clone is compared against what `coerceX` returns.
 *
 * The table itself is checked separately and exhaustively in `coerceScalar`'s
 * own test; this is about the walk — that the right cells get applied at the
 * right positions, under nesting, tuples, pattern keys and the constraint
 * keywords that run after coercion. `"3"` against `{ type: 'integer', minimum:
 * 5 }` has to become `3` and *then* fail `minimum`, which is a different answer
 * from both "reject as a string" and "repair to something valid".
 *
 * Positions where the schema gives more than one answer — a combinator, an
 * array-form `type` — are deliberately absent here and covered by
 * `leaves an ambiguous position alone` below. Ajv resolves those by trying its
 * own coercion list in order, which is a fact about Ajv's list rather than about
 * the schema, so agreeing with it there would mean adopting a rule the schema
 * does not state.
 */

// Deterministic PRNG so a failure reproduces exactly. (mulberry32)
const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T

const toJavaScript = (code: string): string =>
  ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

type Coercer = (input: unknown) => { valid: true; value: unknown } | { valid: false; errors: unknown[] }

/** Compiles the validator and its coercing half together, as a file would carry them. */
const compile = (schema: Record<string, unknown>): Coercer => {
  const code =
    generateValidatorFunction(schema as never, 'Root') + '\n\n' + generateCoerceFunction(schema as never, 'Root').code
  return evaluateGenerated(code)['coerceRoot'] as Coercer
}

const assertAgrees = (schema: Record<string, unknown>, values: readonly unknown[]): void => {
  const coerce = compile(schema)
  // Both sides are compiled once per schema. Compiling Ajv per *value* is what a
  // 3,600-case fuzz spends all its time on, and none of it on the thing under
  // test.
  const validate = new Ajv2020({ allErrors: true, coerceTypes: true }).compile(schema)
  const divergences: string[] = []
  for (const value of values) {
    // Ajv rewrites the instance, so it judges a clone and the clone *is* its
    // answer. The wrapper object both sides are judged through is what gives it
    // something to rewrite: a root scalar arrives by value and cannot be.
    const coercedByAjv = structuredClone(value)
    const ajv = { valid: validate(coercedByAjv) as boolean, value: coercedByAjv }
    const mine = coerce(structuredClone(value))
    if (mine.valid !== ajv.valid) {
      divergences.push(`${JSON.stringify(value)}: ajv valid=${ajv.valid} mjst valid=${mine.valid}`)
      continue
    }
    if (mine.valid && JSON.stringify(mine.value) !== JSON.stringify(ajv.value)) {
      divergences.push(`${JSON.stringify(value)}: ajv=${JSON.stringify(ajv.value)} mjst=${JSON.stringify(mine.value)}`)
    }
  }
  expect(divergences, `schema ${JSON.stringify(schema)}\n${divergences.join('\n')}`).toEqual([])
}

const SCALARS = ['string', 'number', 'integer', 'boolean', 'null'] as const

/** Deliberately hostile: the corners are the only place two tables can disagree. */
const TABLE_VALUES: unknown[] = [
  'true',
  'false',
  'TRUE',
  'yes',
  'on',
  '1',
  '0',
  '',
  ' ',
  ' 1 ',
  '1e3',
  '1.5',
  '-2',
  'abc',
  '007',
  '0x10',
  'Infinity',
  '-0',
  0,
  1,
  2,
  1.5,
  -1,
  -0,
  NaN,
  Infinity,
  true,
  false,
  null,
]
const VALUES: unknown[] = [
  'true',
  'false',
  '1',
  '0',
  '',
  ' ',
  '1e3',
  '1.5',
  '-2',
  'abc',
  '007',
  0,
  1,
  2,
  1.5,
  -1,
  true,
  false,
  null,
  {},
  [],
]

/** The emitted `coerceScalar`, evaluated from the runtime contract itself. */
const coerceScalar = (() => {
  const moduleExports: Record<string, unknown> = {}
  new Function('exports', toJavaScript(VALIDATION_RESULT_CONTENT))(moduleExports)
  return moduleExports['coerceScalar'] as (value: unknown, type: string) => unknown
})()

describe('coerced-vs-ajv', () => {
  // The table itself, cell by cell, against the only thing that defines it.
  // Reconstructing Ajv's rules from its documentation gets the ordinary cases
  // right and the corners wrong, and the corners are the whole risk: a
  // whitespace-only string is `0`, `null` coerces to every scalar type, `"007"`
  // is 7 and `"Infinity"` is an *integer* (Ajv's test is `!(data % 1)`, and
  // `Infinity % 1` is `NaN`, which is falsy). Every one of those was found here
  // rather than reasoned out.
  it('coerces each scalar exactly as ajv does, cell by cell', () => {
    const divergences: string[] = []
    for (const type of SCALARS) {
      const validate = new Ajv2020({ allErrors: true, coerceTypes: true }).compile({
        type: 'object',
        properties: { d: { type } },
      })
      for (const value of TABLE_VALUES) {
        const box: Record<string, unknown> = { d: value }
        const accepted = validate(box) as boolean
        // Ours leaves a value it cannot coerce untouched and lets the validator
        // reject it, so "ajv rejected" and "we changed nothing" are the same
        // answer.
        const expected = accepted ? box['d'] : value
        const actual = coerceScalar(value, type)
        if (!Object.is(actual, expected)) {
          divergences.push(
            `${type} <- ${String(value)} (${typeof value}): ajv=${String(expected)} mjst=${String(actual)}`,
          )
        }
      }
    }
    expect(divergences, divergences.join('\n')).toEqual([])
  })

  it('agrees on a scalar property of every coercible type', () => {
    for (const type of SCALARS) {
      assertAgrees(
        { type: 'object', properties: { d: { type } } },
        VALUES.map((d) => ({ d })),
      )
    }
  })

  it('agrees when a constraint runs after the coercion', () => {
    // The case a repairing parser cannot express: `"3"` becomes `3` and then
    // fails `minimum`, rather than being repaired into something valid.
    assertAgrees(
      { type: 'object', properties: { d: { type: 'integer', minimum: 5 } } },
      ['3', '7', 3, 7, 'abc', true, null].map((d) => ({ d })),
    )
    assertAgrees(
      { type: 'object', properties: { d: { type: 'string', minLength: 2 } } },
      [1, 12, true, null, 'a', 'ab'].map((d) => ({ d })),
    )
    assertAgrees(
      { type: 'object', properties: { d: { type: 'string', pattern: '^[0-9]+$' } } },
      [1, 12, 'x', true, null].map((d) => ({ d })),
    )
  })

  it('agrees when the coerced value has to satisfy an enum or const', () => {
    assertAgrees(
      { type: 'object', properties: { d: { type: 'string', enum: ['1', 'true'] } } },
      [1, true, false, 2, '1', null].map((d) => ({ d })),
    )
    assertAgrees(
      { type: 'object', properties: { d: { type: 'number', const: 3 } } },
      ['3', 3, '4', true, null].map((d) => ({ d })),
    )
  })

  it('agrees on nested objects and arrays', () => {
    assertAgrees(
      {
        type: 'object',
        properties: {
          inner: { type: 'object', properties: { n: { type: 'integer' }, s: { type: 'string' } } },
          list: { type: 'array', items: { type: 'number' } },
          tuple: { type: 'array', prefixItems: [{ type: 'boolean' }, { type: 'integer' }], items: { type: 'string' } },
        },
      },
      [
        { inner: { n: '4', s: 9 } },
        { inner: { n: 'x', s: 9 } },
        { list: ['1', 2, '3.5'] },
        { list: ['abc'] },
        { tuple: ['true', '2', 3, 4] },
        { tuple: [] },
        { inner: 'not an object' },
        { list: 'not an array' },
      ],
    )
  })

  it('agrees on pattern and additional properties', () => {
    assertAgrees(
      {
        type: 'object',
        properties: { known: { type: 'integer' } },
        patternProperties: { '^x-': { type: 'string' } },
        additionalProperties: { type: 'boolean' },
      },
      [{ known: '1', 'x-a': 2, other: 'true' }, { 'x-a': null, other: 0 }, { other: 'nope' }, { known: 'nope' }],
    )
  })

  it('agrees across random schemas and values', { timeout: 60_000 }, () => {
    const rng = makeRng(0x5eed)
    const leaf = (): Record<string, unknown> => {
      const type = pick(rng, SCALARS)
      const node: Record<string, unknown> = { type }
      if (type === 'integer' || type === 'number') {
        if (rng() < 0.3) node['minimum'] = pick(rng, [0, 1, 5])
        if (rng() < 0.2) node['maximum'] = pick(rng, [2, 10])
      }
      if (type === 'string') {
        if (rng() < 0.3) node['minLength'] = pick(rng, [1, 2])
        if (rng() < 0.2) node['pattern'] = pick(rng, ['^[a-z]+$', '^[0-9]+$'])
      }
      return node
    }
    const node = (depth: number): Record<string, unknown> => {
      if (depth <= 0 || rng() < 0.5) return leaf()
      if (rng() < 0.4) return { type: 'array', items: node(depth - 1) }
      const properties: Record<string, unknown> = {}
      for (const key of ['a', 'b', 'c']) if (rng() < 0.7) properties[key] = node(depth - 1)
      const schema: Record<string, unknown> = { type: 'object', properties }
      if (rng() < 0.3) schema['required'] = ['a']
      if (rng() < 0.25) schema['patternProperties'] = { '^x-': leaf() }
      if (rng() < 0.25) schema['additionalProperties'] = rng() < 0.5 ? leaf() : false
      return schema
    }

    for (let i = 0; i < 300; i++) {
      const schema = { type: 'object', properties: { d: node(2) } }
      const values = Array.from({ length: 12 }, () => ({ d: randomValue(rng, 2) }))
      assertAgrees(schema, values)
    }
  })

  // The one place this deliberately does not follow Ajv. Under `type: ['number',
  // 'string']` Ajv walks its own coercion list and turns `"1"` into `1`; under
  // `['string', 'number']` it leaves it a string. That is a rule about the order
  // of Ajv's list, not something the schema says, and quietly changing a value
  // the caller wrote on the strength of it is the one failure mode a coercing
  // validator must not have. Leaving the position alone costs a coercion that
  // could have been made and never makes a wrong one — the validator still
  // judges the value exactly as it always did.
  it('leaves an ambiguous position alone rather than guessing', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        union: { type: ['number', 'string'] },
        branch: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        plain: { type: 'number' },
      },
    })

    const result = coerce({ union: '1', branch: '2', plain: '3' })

    expect(result.valid).toBe(true)
    expect(result.valid && result.value).toEqual({ union: '1', branch: '2', plain: 3 })
  })
})

const STRINGS = ['', 'a', 'abc', '1', '0', 'true', 'false', '1.5', 'x-foo']
const NUMBERS = [-1, 0, 1, 2, 1.5, 10]

function randomValue(rng: () => number, depth: number): unknown {
  const p = rng()
  if (depth <= 0 || p < 0.6) {
    const leaf = rng()
    if (leaf < 0.15) return null
    if (leaf < 0.3) return rng() < 0.5
    if (leaf < 0.6) return pick(rng, STRINGS)
    return pick(rng, NUMBERS)
  }
  if (p < 0.8) return Array.from({ length: Math.floor(rng() * 3) }, () => randomValue(rng, depth - 1))
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'x-c', 'other']) if (rng() < 0.6) out[key] = randomValue(rng, depth - 1)
  return out
}
