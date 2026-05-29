import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { validate } from './validate'

/**
 * Differential fuzz: for a spread of schemas, assert the interpreter's
 * valid/invalid verdict matches Ajv's across a large stream of random and
 * mutated values. This is the safety net behind "fast" — a wrong-but-fast
 * answer is worthless — and it guards the interpreter against drifting from
 * standard JSON Schema semantics.
 *
 * Scope notes: we stay inside the interpreter's draft-07-compatible subset and
 * deliberately exclude the keywords where we *intend* to differ from Ajv
 * (`nullable`, lenient non-schema nodes) — those have dedicated unit tests.
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

const STRINGS = ['', 'a', 'abc', 'hello', 'Ada', 'admin', 'user', '42', 'num_x', 'x']
const NUMBERS = [-1, 0, 0.5, 1, 2, 3, 10, 100, -0.5, 4.5]

/** Generates a random JSON value with bounded depth. */
const randomValue = (rng: () => number, depth: number): unknown => {
  const pick = rng()
  if (depth <= 0 || pick < 0.18) {
    const leaf = rng()
    if (leaf < 0.2) return null
    if (leaf < 0.4) return rng() < 0.5
    if (leaf < 0.7) return NUMBERS[Math.floor(rng() * NUMBERS.length)]
    return STRINGS[Math.floor(rng() * STRINGS.length)]
  }
  if (pick < 0.5) {
    const len = Math.floor(rng() * 4)
    return Array.from({ length: len }, () => randomValue(rng, depth - 1))
  }
  const keys = ['id', 'name', 'tags', 'role', 'score', 'a', 'b', 'num_x', 'extra']
  const out: Record<string, unknown> = {}
  const count = Math.floor(rng() * 5)
  for (let i = 0; i < count; i++) {
    out[keys[Math.floor(rng() * keys.length)] as string] = randomValue(rng, depth - 1)
  }
  return out
}

/** Applies a single structural mutation to a (JSON-cloned) value. */
const mutate = (rng: () => number, value: unknown): unknown => {
  if (Array.isArray(value) && value.length > 0) {
    const copy = value.slice()
    const i = Math.floor(rng() * copy.length)
    if (rng() < 0.5) copy[i] = randomValue(rng, 2)
    else copy.splice(i, 1)
    return copy
  }
  if (value !== null && typeof value === 'object') {
    const copy = { ...(value as Record<string, unknown>) }
    const keys = Object.keys(copy)
    if (keys.length > 0 && rng() < 0.5) {
      const k = keys[Math.floor(rng() * keys.length)] as string
      if (rng() < 0.5) delete copy[k]
      else copy[k] = randomValue(rng, 2)
    } else {
      copy[`k${Math.floor(rng() * 5)}`] = randomValue(rng, 2)
    }
    return copy
  }
  return randomValue(rng, 2)
}

// `dialect` selects which Ajv build to compare against: keywords added in
// 2019-09/2020-12 (dependentSchemas, min/maxContains) are unknown to draft-07
// Ajv, while `dependencies` was *removed* after draft-07 — so each case names
// the dialect whose Ajv actually understands its keywords.
type Case = { name: string; schema: Record<string, unknown>; seeds: unknown[]; dialect?: 'draft7' | '2020' }

const CASES: Case[] = [
  {
    name: 'object with required, typed props, additionalProperties:false',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string', minLength: 1, maxLength: 10 },
        tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        role: { enum: ['admin', 'user'] },
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['id', 'name'],
      additionalProperties: false,
    },
    seeds: [
      { id: 1, name: 'Ada' },
      { id: 1, name: 'Ada', tags: ['a', 'b'], role: 'admin', score: 50 },
      { id: 1.5, name: '' },
      { name: 'Ada' },
      { id: 1, name: 'Ada', extra: true },
      { id: 1, name: 'Ada', tags: ['a', 'a'] },
    ],
  },
  {
    name: 'patternProperties + additionalProperties schema',
    schema: {
      type: 'object',
      patternProperties: { '^num_': { type: 'number' } },
      additionalProperties: { type: 'string' },
    },
    seeds: [{ num_x: 1, other: 'y' }, { num_x: 'no' }, { other: 5 }, {}],
  },
  {
    name: 'draft-07 tuple with additionalItems:false',
    schema: {
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
      additionalItems: false,
      minItems: 1,
      maxItems: 3,
    },
    seeds: [['a', 1], ['a'], ['a', 1, 'x'], [1, 1], []],
  },
  {
    name: 'numeric bounds and multipleOf',
    schema: { type: 'number', minimum: 0, exclusiveMaximum: 10, multipleOf: 0.5 },
    seeds: [0, 9.5, -1, 10, 0.3, 2.5],
  },
  {
    name: 'combinators: anyOf / oneOf / not',
    schema: {
      allOf: [{ type: 'object' }],
      anyOf: [{ properties: { kind: { const: 'a' } } }, { properties: { kind: { const: 'b' } } }],
      oneOf: [{ required: ['x'] }, { required: ['y'] }],
      not: { required: ['forbidden'] },
    },
    seeds: [
      { kind: 'a', x: 1 },
      { kind: 'b', y: 2 },
      { kind: 'a', x: 1, y: 2 },
      { kind: 'a', forbidden: 1 },
    ],
  },
  {
    name: 'recursive $ref tree',
    schema: {
      $ref: '#/definitions/node',
      definitions: {
        node: {
          type: 'object',
          properties: { value: { type: 'number' }, children: { type: 'array', items: { $ref: '#/definitions/node' } } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    },
    seeds: [{ value: 1 }, { value: 1, children: [{ value: 2 }] }, { value: 'x' }, { value: 1, children: [{}] }],
  },
  {
    name: 'contains (at least one number)',
    schema: { type: 'array', contains: { type: 'number' } },
    seeds: [[], [1], [1, 'a'], ['a', 'b'], [1, 2, 3]],
  },
  {
    name: 'contains with min/maxContains',
    dialect: '2020',
    schema: { type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 3 },
    seeds: [['a', 1, 2], [1], [1, 2, 3], [1, 2, 3, 4], []],
  },
  {
    name: 'propertyNames pattern',
    schema: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
    seeds: [{ a: 1 }, { abc: 2 }, { Foo: 1 }, { num_x: 1 }, {}, { a: 1, B: 2 }],
  },
  {
    name: 'dependentSchemas',
    dialect: '2020',
    schema: {
      type: 'object',
      properties: { creditCard: { type: 'number' } },
      dependentSchemas: {
        creditCard: { required: ['billingAddress'], properties: { billingAddress: { type: 'string' } } },
      },
    },
    seeds: [
      {},
      { creditCard: 1 },
      { creditCard: 1, billingAddress: 'x' },
      { billingAddress: 'x' },
      { creditCard: 1, billingAddress: 5 },
    ],
  },
  {
    name: 'draft-07 dependencies (array + schema forms)',
    schema: {
      type: 'object',
      dependencies: { creditCard: ['billingAddress'], foo: { required: ['bar'] } },
    },
    seeds: [{}, { creditCard: 1, billingAddress: 'x' }, { creditCard: 1 }, { foo: 1, bar: 2 }, { foo: 1 }],
  },
]

describe('differential fuzz vs ajv', () => {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const ajv2020 = new Ajv2020({ allErrors: true, strict: false })

  for (const testCase of CASES) {
    it(`agrees with ajv: ${testCase.name}`, () => {
      const ours = validate(testCase.schema)
      const compiler = testCase.dialect === '2020' ? ajv2020 : ajv
      const ajvValidate = compiler.compile(testCase.schema)
      const rng = makeRng(0x1234 + testCase.name.length)

      const iterations = 12_000
      let divergence: { value: unknown; ours: boolean; ajv: boolean } | undefined

      for (let i = 0; i < iterations && divergence === undefined; i++) {
        // Half the runs start from a curated seed (to reach the valid branch
        // and its boundaries), half from pure noise; both get 0-3 mutations.
        let value: unknown =
          i % 2 === 0 ? structuredClone(testCase.seeds[i % testCase.seeds.length]) : randomValue(rng, 3)
        const mutations = Math.floor(rng() * 4)
        for (let m = 0; m < mutations; m++) value = mutate(rng, value)

        const oursValid = ours(value) === true
        const ajvValid = ajvValidate(value) === true
        if (oursValid !== ajvValid) divergence = { value, ours: oursValid, ajv: ajvValid }
      }

      expect(divergence, divergence && `diverged on ${JSON.stringify(divergence.value)}`).toBeUndefined()
    })
  }
})
