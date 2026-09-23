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
 * The contract is *subset*, not equality. Every value this coerces, Ajv coerces
 * to the same value; Ajv coerces some things this deliberately will not. That is
 * the safe direction and the one that makes a migration off Ajv legible: a value
 * never comes out different, some of Ajv's silent repairs come out as errors
 * instead. `coerces only what ajv coerces, and to the same value` pins it over
 * the whole table, and `divergences` enumerates every cell where the two part
 * company and why.
 *
 * Two things are compared where the rules coincide, not one: the verdict, as
 * everywhere else in this package; and the *value*, because a coercing validator
 * that agrees on accept/reject while producing a different number is worse than
 * one that disagrees loudly. Ajv coerces in place, so the oracle is run against a
 * clone and the clone is compared against what `coerceX` returns.
 *
 * `"3"` against `{ type: 'integer', minimum: 5 }` has to become `3` and *then*
 * fail `minimum`, which is a different answer from both "reject as a string" and
 * "repair to something valid".
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

const generated = (schema: Record<string, unknown>): Record<string, unknown> =>
  evaluateGenerated(
    generateValidatorFunction(schema as never, 'Root') + '\n\n' + generateCoerceFunction(schema as never, 'Root').code,
  )

/** Compiles the validator and its coercing half together, as a file would carry them. */
const compile = (schema: Record<string, unknown>): Coercer => generated(schema)['coerceRoot'] as Coercer

/** The coercion walk alone, which returns its value whether or not it validates. */
const compileWalk = (schema: Record<string, unknown>): ((input: unknown) => unknown) =>
  generated(schema)['coerceRootValue'] as (input: unknown) => unknown

/**
 * The subset property at every position of a structure: what we produced is
 * either what the caller wrote or what Ajv would have produced. Declining is
 * always allowed; inventing a third answer never is.
 */
const invented = (original: unknown, mine: unknown, ajv: unknown, path = ''): string[] => {
  if (Array.isArray(mine)) {
    if (!Array.isArray(original) || !Array.isArray(ajv)) return []
    return mine.flatMap((item, index) => invented(original[index], item, ajv[index], `${path}/${index}`))
  }
  if (mine !== null && typeof mine === 'object') {
    if (original === null || typeof original !== 'object' || ajv === null || typeof ajv !== 'object') return []
    const o = original as Record<string, unknown>
    const a = ajv as Record<string, unknown>
    return Object.keys(mine as Record<string, unknown>).flatMap((key) =>
      invented(o[key], (mine as Record<string, unknown>)[key], a[key], `${path}/${key}`),
    )
  }
  if (Object.is(mine, original) || Object.is(mine, ajv)) return []
  return [`${path}: wrote ${String(original)}, ajv ${String(ajv)}, mjst ${String(mine)}`]
}

const assertNeverInvents = (schema: Record<string, unknown>, values: readonly unknown[]): void => {
  const walk = compileWalk(schema)
  const validate = new Ajv2020({ allErrors: true, coerceTypes: true }).compile(schema)
  const divergences: string[] = []
  for (const value of values) {
    const byAjv = structuredClone(value)
    validate(byAjv)
    divergences.push(...invented(value, walk(structuredClone(value)), byAjv))
  }
  expect(divergences, `schema ${JSON.stringify(schema)}\n${divergences.join('\n')}`).toEqual([])
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
  // The subset property, cell by cell, over deliberately hostile values. This is
  // what makes "more precise than Ajv" a checkable claim rather than a hope: we
  // may decline where Ajv coerces, but we may never produce a value Ajv would not
  // have produced. Anything else would silently change data on migration.
  it('coerces only what ajv coerces, and to the same value', () => {
    const divergences: string[] = []
    for (const type of SCALARS) {
      const validate = new Ajv2020({ allErrors: true, coerceTypes: true }).compile({
        type: 'object',
        properties: { d: { type } },
      })
      for (const value of TABLE_VALUES) {
        const box: Record<string, unknown> = { d: value }
        const ajv = (validate(box) as boolean) ? box['d'] : value
        const mine = coerceScalar(value, type)
        // Declining is always allowed. Producing something Ajv would not is not.
        if (!Object.is(mine, value) && !Object.is(mine, ajv)) {
          divergences.push(`${type} <- ${String(value)} (${typeof value}): ajv=${String(ajv)} mjst=${String(mine)}`)
        }
      }
    }
    expect(divergences, divergences.join('\n')).toEqual([])
  })

  // Every cell where we deliberately decline something Ajv accepts. Written out
  // rather than derived, because each one is a judgement that should have to be
  // edited by hand if it ever changes.
  it('declines exactly the cells ajv guesses at', () => {
    const cases: ReadonlyArray<readonly [unknown, string, string]> = [
      // `Number(" ")` is 0. A config that says `retries: " "` has a mistake in it,
      // and answering `0` is the one thing worse than rejecting it.
      [' ', 'number', 'whitespace is not a number'],
      [' 1 ', 'number', 'a padded numeral is not a numeral'],
      ['0x10', 'number', 'JSON has no hex literals'],
      ['Infinity', 'number', 'JSON cannot represent it'],
      ['Infinity', 'integer', 'and Ajv calls it an integer, because `Infinity % 1` is NaN'],
      ['1.', 'number', 'a trailing point is a typo, not a number'],
      // `null` is a JSON value in its own right and usually means "not set".
      [null, 'string', 'null is not an empty string'],
      [null, 'number', 'null is not zero'],
      [null, 'boolean', 'null is not false'],
      ['', 'null', 'an empty string is not null'],
      [0, 'null', 'zero is not null'],
      [false, 'null', 'false is not null'],
    ]

    for (const [value, type, why] of cases) {
      expect(coerceScalar(value, type), `${type} <- ${String(value)}: ${why}`).toBe(value)
    }
  })

  // The numeric-string grammar is scanned by hand because the regex was the
  // single most expensive thing a number coercion did. The regex stays here as
  // the specification, and the scan has to accept exactly what it accepts.
  it('reads a numeric string exactly as the grammar says', () => {
    const grammar = /^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/
    const rng = makeRng(0x5ca1)
    const alphabet = ['0', '1', '7', '9', '+', '-', '.', 'e', 'E', ' ', 'x', 'a', '_']
    const disagreements: string[] = []
    for (let i = 0; i < 20_000; i++) {
      const text = Array.from({ length: Math.floor(rng() * 7) }, () => pick(rng, alphabet)).join('')
      const expected = grammar.test(text) && Number.isFinite(Number(text)) ? Number(text) : text
      const actual = coerceScalar(text, 'number')
      if (!Object.is(actual, expected)) disagreements.push(`${JSON.stringify(text)}: ${String(actual)}`)
    }
    expect(disagreements.slice(0, 10)).toEqual([])
  })

  it('never invents a value for a scalar property of any coercible type', () => {
    for (const type of SCALARS) {
      assertNeverInvents(
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
    assertNeverInvents(
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
      assertNeverInvents(schema, values)
    }
  })

  // The two properties everything else rests on, over schemas built from every
  // keyword coercion walks into. Ajv is not the oracle for the *value* here: it
  // coerces in place while it tries each branch, so its answer under a union is
  // often whatever the last branch it tried left behind. What is checked instead:
  //
  //  - anything accepted is valid by the schema itself, judged by an Ajv that
  //    does not coerce. So accepting a document Ajv rejects is only ever
  //    accepting a valid document Ajv's own coercion broke;
  //  - a document that is already valid comes back as the very same object,
  //    which is what lets `coerceX` answer valid input with the guard alone.
  it('accepts only valid documents, and leaves a valid one untouched', { timeout: 120_000 }, () => {
    const rng = makeRng(0xc0e7ce)
    const leaf = (): Record<string, unknown> => {
      if (rng() < 0.15) return { const: pick(rng, [false, true, 'x', 1]) }
      const type = pick(rng, ['string', 'number', 'integer', 'boolean'] as const)
      const node: Record<string, unknown> = { type }
      if (rng() < 0.2 && (type === 'integer' || type === 'number')) node['minimum'] = 1
      if (rng() < 0.2 && type === 'string') node['minLength'] = 2
      return node
    }
    const node = (depth: number): Record<string, unknown> => {
      if (depth <= 0 || rng() < 0.3) return leaf()
      const roll = rng()
      const branches = (): Record<string, unknown>[] =>
        Array.from({ length: 2 + Math.floor(rng() * 2) }, () => node(depth - 1))
      if (roll < 0.2) return { anyOf: branches() }
      if (roll < 0.3) return { oneOf: branches() }
      if (roll < 0.4) return { allOf: branches() }
      if (roll < 0.5) return { type: 'array', items: node(depth - 1) }
      const properties: Record<string, unknown> = {}
      for (const key of ['a', 'b', 'c']) if (rng() < 0.7) properties[key] = node(depth - 1)
      const object: Record<string, unknown> = { type: 'object', properties }
      if (rng() < 0.3) object['required'] = ['a']
      if (rng() < 0.25) {
        object['if'] = { properties: { a: { const: pick(rng, [true, 'x', 1]) } }, required: ['a'] }
        object['then'] = { properties: { b: node(depth - 1) } }
        if (rng() < 0.5) object['else'] = { properties: { b: node(depth - 1) } }
      }
      return object
    }

    const problems: string[] = []
    for (let i = 0; i < 400; i++) {
      const schema = { type: 'object', properties: { d: node(3) } }
      const exports = generated(schema)
      const coerce = exports['coerceRoot'] as Coercer
      const walk = exports['coerceRootValue'] as (input: unknown) => unknown
      const validate = exports['validateRoot'] as (input: unknown) => unknown
      const plain = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
      for (let j = 0; j < 15; j++) {
        const value = { d: randomValue(rng, 3) }
        const result = coerce(structuredClone(value))
        if (result.valid && !plain(structuredClone(result.value))) {
          problems.push(`accepted an invalid document: ${JSON.stringify(schema)} ${JSON.stringify(value)}`)
        }
        if (validate(value) === true && walk(value) !== value) {
          problems.push(`rewrote a valid document: ${JSON.stringify(schema)} ${JSON.stringify(value)}`)
        }
      }
    }
    expect(problems, problems.slice(0, 5).join('\n')).toEqual([])
  })

  // `string | { … }` is the commonest shape in a hand-written config schema, and
  // the scalars inside the object branch are exactly what a YAML file gets wrong.
  it('agrees on scalars inside an object branch of a union', () => {
    const method = {
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: { enabled: { type: 'boolean' }, endpoint: { type: 'string' }, retries: { type: 'integer' } },
          required: ['enabled'],
        },
      ],
    }
    assertAgrees({ type: 'object', properties: { d: method } }, [
      { d: { enabled: 'true' } },
      { d: { enabled: true, endpoint: 42 } },
      { d: { enabled: 'false', retries: '3' } },
      { d: { enabled: 'nope' } },
      { d: { endpoint: 'x' } },
      { d: 7 },
      { d: 'short' },
      { d: { enabled: 1, retries: 'many' } },
    ])
    assertAgrees({ type: 'object', properties: { d: { anyOf: [{ const: 'off' }, method] } } }, [
      { d: 'off' },
      { d: { enabled: 'true', endpoint: 1 } },
      { d: { enabled: 0 } },
    ])
  })

  it('agrees on a union nested inside a union', () => {
    assertAgrees(
      {
        type: 'object',
        properties: {
          d: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  inner: { anyOf: [{ type: 'integer' }, { type: 'object', properties: { n: { type: 'number' } } }] },
                },
              },
            ],
          },
        },
      },
      [{ d: { inner: '4' } }, { d: { inner: { n: '1.5' } } }, { d: { inner: 'x' } }, { d: 3 }, { d: { inner: 4 } }],
    )
  })

  // The other place this deliberately does not follow Ajv, and the one with
  // consequences. Ajv coerces into the first branch that will take the value, so
  // `false` becomes `"false"` through the string branch and the `const: false`
  // branch — written for exactly this input — is never reached. Code reading
  // `keyOpt === false` then sees a truthy string. A branch the value already
  // matches wins here, so the value comes through as written.
  it('keeps a value a later branch takes as written, where ajv coerces it into an earlier one', () => {
    const schema = { type: 'object', properties: { keyOpt: { anyOf: [{ type: 'string' }, { const: false }] } } }
    const byAjv: Record<string, unknown> = { keyOpt: false }
    new Ajv2020({ allErrors: true, coerceTypes: true }).compile(schema)(byAjv)

    expect(byAjv).toEqual({ keyOpt: 'false' })
    expect(compile(schema)({ keyOpt: false })).toEqual({ valid: true, value: { keyOpt: false } })
  })

  // A place this deliberately does not follow Ajv. Under `type: ['number',
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
