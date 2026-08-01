import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser, makeRng, pick } from './differential.test-utils'

/**
 * Differential fuzz for the strict parser's *composition and constraint*
 * vocabulary, with Ajv 2020 as the oracle — the half of the keyword surface the
 * other three fuzzers do not reach. They cover shape (types, enums, required,
 * `additionalProperties: false`, arrays of scalar/object items) and the
 * `contains` / `dependent*` / `propertyNames` family; this one covers:
 *
 *   `const` (scalar and structural), `minProperties` / `maxProperties`, `not`,
 *   `allOf`, `if` / `then` / `else`, `patternProperties`, a schema-valued
 *   `additionalProperties`, nested-array `items`, nullable (`["object","null"]`)
 *   object properties, and boolean (`true` / `false`) property schemas.
 *
 * Every one of those was silently unenforced at some point: the parser's
 * fast-path guard is built from flat per-property type checks, so a keyword it
 * cannot mirror has to (a) disable the guard and (b) appear in the slow-path
 * assertions — miss either half and a strict parser accepts documents the schema
 * rejects. The contract asserted here is the same one the other fuzzers use:
 *
 *   parse(input) throws  ⇔  Ajv rejects input,
 *   and an accepted value deep-equals the input (strict mode never mutates a
 *   value it accepts).
 *
 * Schemas are assembled from independent feature fragments rather than
 * hand-listed, so combinations nobody thought to write down still get exercised.
 */

type Rng = () => number
type Schema = Record<string, unknown>

const SCALARS: readonly unknown[] = ['', 'x', 'ab', 'abc', 'toolong', 0, 1, 1.5, 3, 6, -1, true, false, null]

/** A random JSON value, biased toward the shapes the fragments constrain. */
const randomValue = (rng: Rng, depth = 2): unknown => {
  const k = rng()
  if (depth <= 0 || k < 0.5) return pick(rng, SCALARS)
  if (k < 0.75) return Array.from({ length: Math.floor(rng() * 3) }, () => randomValue(rng, depth - 1))
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'n', 's_v', 'zz']) if (rng() < 0.45) out[key] = randomValue(rng, depth - 1)
  return out
}

/** A random object candidate whose keys span declared, pattern-matching and stray names. */
const randomObject = (rng: Rng): unknown => {
  if (rng() < 0.08) return pick(rng, SCALARS)
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'n', 'k', 's_v']) if (rng() < 0.55) out[key] = randomValue(rng)
  if (rng() < 0.35) out[pick(rng, ['extra', 's_w', 'ZZ'])] = randomValue(rng)
  return out
}

/**
 * A feature fragment: keywords merged into an object schema, or (for the
 * root-shaped ones) a whole schema plus its own candidate generator.
 */
type Fragment = { schema: Schema; candidate?: (rng: Rng) => unknown }

/** Fragments merged into a base object schema — several can apply at once. */
const objectFragments: ((rng: Rng) => Fragment)[] = [
  () => ({ schema: { properties: { k: { const: 'fixed' } } } }),
  () => ({ schema: { properties: { k: { const: { p: 1, q: [2] } } } } }),
  () => ({ schema: { properties: { k: { const: null } } } }),
  (rng) => ({ schema: { minProperties: pick(rng, [1, 2, 3]) } }),
  (rng) => ({ schema: { maxProperties: pick(rng, [1, 2, 3]) } }),
  () => ({ schema: { properties: { a: { type: 'object', minProperties: 2 } } } }),
  () => ({ schema: { not: { required: ['zz'] } } }),
  () => ({ schema: { properties: { a: { type: 'string', not: { const: 'nope' } } } } }),
  () => ({ schema: { allOf: [{ minProperties: 2 }] } }),
  () => ({ schema: { allOf: [{ type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }] } }),
  () => ({ schema: { if: { required: ['a'] }, then: { required: ['b'] } } }),
  () => ({
    schema: {
      if: { properties: { k: { const: 'x' } }, required: ['k'] },
      then: { required: ['n'] },
      else: { required: ['a'] },
    },
  }),
  () => ({ schema: { patternProperties: { '^s_': { type: 'string', minLength: 2 } } } }),
  () => ({ schema: { additionalProperties: { type: 'number' } } }),
  () => ({ schema: { additionalProperties: { type: 'string', minLength: 3 } } }),
  () => ({ schema: { properties: { a: { type: 'object', additionalProperties: { type: 'number' } } } } }),
  () => ({ schema: { properties: { a: { type: 'array', items: { type: 'array', items: { type: 'number' } } } } } }),
  () => ({
    schema: { properties: { a: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } } } },
  }),
  () => ({
    schema: { properties: { a: { type: ['object', 'null'], properties: { z: { type: 'string' } }, required: ['z'] } } },
  }),
  () => ({ schema: { properties: { a: true, b: false } } }),
  () => ({
    schema: {
      properties: {
        a: { oneOf: [{ type: 'object', properties: { z: { type: 'string' } }, minProperties: 2 }, { type: 'number' }] },
      },
    },
  }),
]

/** Whole-schema fragments that are not object-shaped. */
const rootFragments: ((rng: Rng) => Fragment)[] = [
  () => ({ schema: { not: { type: 'string' } }, candidate: (r) => randomValue(r) }),
  () => ({ schema: { allOf: [{ type: 'number', minimum: 5 }, { multipleOf: 2 }] }, candidate: (r) => randomValue(r) }),
  () => ({
    schema: {
      allOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { minProperties: 2 }],
    },
    candidate: randomObject,
  }),
  (rng) => ({
    schema: {
      type: 'array',
      minItems: pick(rng, [1, 2]),
      maxItems: 3,
      items: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    },
    candidate: (r) => Array.from({ length: Math.floor(r() * 5) }, () => (r() < 0.6 ? { a: 'x' } : randomValue(r))),
  }),
  () => ({
    schema: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
    candidate: (r) => Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r)),
  }),
  () => ({ schema: { type: 'object', required: ['a', 'b'], minProperties: 3 }, candidate: randomObject }),
  () => ({
    schema: { type: 'object', patternProperties: { '^s_': { type: 'string' } }, additionalProperties: false },
    candidate: randomObject,
  }),
]

/** Merges fragment keywords into a base schema, deep-merging only `properties`. */
const merge = (base: Schema, extra: Schema): Schema => {
  const out: Schema = { ...base, ...extra }
  if (base['properties'] && extra['properties']) {
    out['properties'] = { ...(base['properties'] as Schema), ...(extra['properties'] as Schema) }
  }
  return out
}

const buildCase = (rng: Rng): Fragment => {
  if (rng() < 0.3) return pick(rng, rootFragments)(rng)
  let schema: Schema = {
    type: 'object',
    properties: { a: {}, n: { type: 'number' } },
  }
  const count = 1 + Math.floor(rng() * 2)
  for (let i = 0; i < count; i++) schema = merge(schema, pick(rng, objectFragments)(rng).schema)
  if (rng() < 0.3) schema['required'] = ['a']
  return { schema, candidate: randomObject }
}

describe('composition & constraint conformance vs ajv', () => {
  it('strict mode throws exactly when ajv rejects, and returns accepted values unchanged', { timeout: 120_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x9e3779b)
    const failures: string[] = []

    for (let i = 0; i < 900 && failures.length < 8; i++) {
      const { schema, candidate } = buildCase(rng)

      let check: (value: unknown) => boolean
      try {
        check = ajv.compile(schema)
      } catch {
        continue
      }

      let parse: (input: unknown) => unknown
      try {
        parse = evalGenerated<(input: unknown) => unknown>(
          generateFileParser(schema as never, 'Root', { strict: true }),
          'parseRoot',
        )
      } catch (error) {
        // A generation-time refusal is the documented alternative to a
        // permissive parser, so it is not a conformance failure.
        if (/unsupported keyword/.test((error as Error).message)) continue
        failures.push(`generation failed\n  schema: ${JSON.stringify(schema)}\n  error: ${(error as Error).message}`)
        continue
      }

      for (let t = 0; t < 14 && failures.length < 8; t++) {
        const input = (candidate ?? randomObject)(rng)
        const valid = check(structuredClone(input))
        let output: unknown
        let threw = false
        try {
          output = parse(structuredClone(input))
        } catch {
          threw = true
        }
        if (threw === valid) {
          failures.push(
            `${threw ? 'rejected a valid' : 'accepted an invalid'} value\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}`,
          )
        } else if (!threw && !isDeepStrictEqual(output, input)) {
          failures.push(
            `changed an accepted value\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}\n  output: ${JSON.stringify(output)}`,
          )
        }
      }
    }

    expect(failures, failures.join('\n\n')).toEqual([])
  })
})
