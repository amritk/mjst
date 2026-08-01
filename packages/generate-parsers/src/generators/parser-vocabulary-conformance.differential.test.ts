import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser, makeRng, pick } from './differential.test-utils'

/**
 * Differential fuzz for the keyword vocabulary the strict parser used to refuse
 * or silently ignore, with Ajv 2020 as the oracle:
 *
 *   `$ref` (pointer, `$anchor`, with 2020-12 siblings, inside `contains` /
 *   `not` / `propertyNames` / `dependentSchemas` / a combinator),
 *   `prefixItems` with an `items` tail and `items: false`, `contains` with
 *   `minContains` / `maxContains`, `patternProperties` against a schema-valued
 *   `additionalProperties`, `propertyNames`, `dependentRequired`,
 *   `dependentSchemas`, `unevaluatedProperties`, `unevaluatedItems`, type-less
 *   constraints, and array-form (`["object","null"]`) types.
 *
 * Each of those either threw at generation time ("unsupported keyword") or was
 * enforced by nothing at all, which is the failure mode this file exists to
 * keep closed: the contract is the same one the other fuzzers assert —
 *
 *   parse(input) throws  ⇔  Ajv rejects input,
 *   and an accepted value deep-equals the input.
 *
 * Schemas are assembled from independent fragments over a shared `$defs`, so
 * combinations nobody thought to write down still get exercised.
 */

type Rng = () => number
type Schema = Record<string, unknown>

/** The definitions every fragment's `$ref`s point at. */
const DEFS: Schema = {
  posInt: { type: 'integer', minimum: 0 },
  shortName: { $anchor: 'short', type: 'string', maxLength: 3 },
  pair: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
  needsB: { required: ['b'] },
}

const SCALARS: readonly unknown[] = ['', 'x', 'ab', 'abcd', '💩', '💩💩', 0, 1, 2, 3, 7, -1, 1.5, true, false, null]

const randomValue = (rng: Rng, depth = 2): unknown => {
  const k = rng()
  if (depth <= 0 || k < 0.45) return pick(rng, SCALARS)
  if (k < 0.75) return Array.from({ length: Math.floor(rng() * 4) }, () => randomValue(rng, depth - 1))
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'n', 's_v', 'zz']) if (rng() < 0.5) out[key] = randomValue(rng, depth - 1)
  return out
}

/** An object candidate spanning declared, pattern-matching, and stray key names. */
const randomObject = (rng: Rng): unknown => {
  if (rng() < 0.1) return pick(rng, SCALARS)
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'own', 'fromRef', 's_v']) if (rng() < 0.55) out[key] = randomValue(rng, 1)
  if (rng() < 0.4) out[pick(rng, ['extra', 's_w', 'LONGNAME'])] = randomValue(rng, 1)
  return out
}

const randomArray = (rng: Rng): unknown => {
  if (rng() < 0.1) return pick(rng, SCALARS)
  return Array.from({ length: Math.floor(rng() * 5) }, () => randomValue(rng, 1))
}

type Fragment = { schema: Schema; candidate: (rng: Rng) => unknown }

const objectFragments: readonly Schema[] = [
  { properties: { a: { $ref: '#/$defs/posInt' } } },
  { properties: { a: { $ref: '#/$defs/pair', minProperties: 2 } } },
  { properties: { a: { $ref: '#short' } } },
  { $ref: '#/$defs/needsB' },
  { allOf: [{ $ref: '#/$defs/needsB' }] },
  { not: { $ref: '#/$defs/needsB' } },
  { propertyNames: { $ref: '#short' } },
  { dependentSchemas: { a: { $ref: '#/$defs/needsB' } } },
  { dependentRequired: { a: ['b'] } },
  { propertyNames: { maxLength: 3 } },
  { patternProperties: { '^s_': { type: 'string', minLength: 2 } }, additionalProperties: { type: 'number' } },
  { properties: { own: {} }, unevaluatedProperties: false },
  { properties: { own: {} }, unevaluatedProperties: { type: 'number' } },
  { $ref: '#/$defs/pair', properties: { own: {} }, unevaluatedProperties: false },
  {
    anyOf: [{ properties: { a: { type: 'number' } }, required: ['a'] }, { properties: { b: { type: 'string' } } }],
    unevaluatedProperties: false,
  },
  { if: { required: ['a'] }, then: { properties: { b: {} } }, properties: { a: {} }, unevaluatedProperties: false },
  { minProperties: 1, maxProperties: 3 },
  { properties: { a: false } },
]

const arrayFragments: readonly Schema[] = [
  { type: 'array', prefixItems: [{ type: 'number' }, { $ref: '#short' }] },
  { type: 'array', prefixItems: [{ type: 'number' }], items: false },
  { type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'string' } },
  { type: 'array', prefixItems: [{ type: 'number' }], unevaluatedItems: false },
  { type: 'array', prefixItems: [{ type: 'number' }], unevaluatedItems: { type: 'string' } },
  { type: 'array', contains: { $ref: '#/$defs/posInt' } },
  { type: 'array', contains: { const: 1 }, minContains: 2, maxContains: 3 },
  { type: 'array', contains: { type: 'number' }, unevaluatedItems: false },
  { type: 'array', items: { $ref: '#/$defs/pair' } },
  { type: 'array', items: false },
  { type: 'array', uniqueItems: true, minItems: 1 },
]

/** Type-less and multi-type roots: the shapes whose constraints hung on nothing. */
const looseFragments: readonly Schema[] = [
  { minimum: 5 },
  { pattern: 'a' },
  { minLength: 2 },
  { maxLength: 2 },
  { $ref: '#/$defs/posInt' },
  { $ref: '#/$defs/shortName', minLength: 2 },
  { type: ['string', 'null'], minLength: 2 },
  { type: ['object', 'null'], properties: { a: { type: 'string' } }, required: ['a'] },
  { type: ['array', 'null'], items: { type: 'number' }, minItems: 1 },
  // A `type` with more than one non-null member: each family's constraints bind
  // only its own branch, which no single-typed view can express.
  { type: ['string', 'array'], minLength: 3, minItems: 2 },
  { type: ['object', 'array'], required: ['a'], minItems: 1 },
  { required: ['a'] },
  { minProperties: 2 },
]

const buildCase = (rng: Rng): Fragment => {
  const k = rng()
  if (k < 0.3) return { schema: { ...pick(rng, arrayFragments), $defs: DEFS }, candidate: randomArray }
  if (k < 0.45) return { schema: { ...pick(rng, looseFragments), $defs: DEFS }, candidate: (r) => randomValue(r) }

  // Object fragments merge, so a `$ref` sibling meets an `unevaluatedProperties`
  // meets a `propertyNames` without anyone hand-writing that combination.
  let schema: Schema = { type: 'object', $defs: DEFS }
  const count = 1 + Math.floor(rng() * 2)
  for (let i = 0; i < count; i++) {
    const fragment = pick(rng, objectFragments)
    const merged: Schema = { ...schema, ...fragment }
    if (schema['properties'] && fragment['properties']) {
      merged['properties'] = { ...(schema['properties'] as Schema), ...(fragment['properties'] as Schema) }
    }
    schema = merged
  }
  return { schema, candidate: randomObject }
}

describe('keyword vocabulary conformance vs ajv', () => {
  it('strict mode throws exactly when ajv rejects, and returns accepted values unchanged', { timeout: 120_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x5eed_1e55)
    const failures: string[] = []
    let generated = 0

    for (let i = 0; i < 900 && failures.length < 8; i++) {
      const { schema, candidate } = buildCase(rng)

      let check: (value: unknown) => boolean
      try {
        check = ajv.compile(structuredClone(schema) as never)
      } catch {
        continue
      }

      let parse: (input: unknown) => unknown
      try {
        parse = evalGenerated<(input: unknown) => unknown>(
          generateFileParser(schema as never, 'Root', { strict: true }),
          'parseRoot',
        )
        generated++
      } catch (error) {
        // A generation-time refusal is the documented alternative to a
        // permissive parser, so it is not a conformance failure.
        if (/unsupported keyword/.test((error as Error).message)) continue
        failures.push(`generation failed\n  schema: ${JSON.stringify(schema)}\n  error: ${(error as Error).message}`)
        continue
      }

      for (let t = 0; t < 12 && failures.length < 8; t++) {
        const input = candidate(rng)
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
    // A vocabulary this fuzzer can no longer generate parsers for would pass
    // vacuously, so hold the floor: most cases must reach a real parser.
    expect(generated).toBeGreaterThan(600)
  })
})
