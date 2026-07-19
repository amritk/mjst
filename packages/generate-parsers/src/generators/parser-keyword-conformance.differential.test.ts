import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser, makeRng, pick } from './differential.test-utils'

/**
 * Differential fuzz for the strict-mode enforcement of `contains` /
 * `minContains` / `maxContains`, `dependentRequired`, `dependentSchemas`, and
 * `propertyNames`, with Ajv 2020 as the oracle. Each schema template attaches
 * one keyword feature to an open object (or array) schema, then random
 * candidate values are fed to both the generated strict parser and Ajv:
 *
 *   parse(input) throws  ⇔  Ajv rejects input,
 *   and an accepted value deep-equals the input (strict mode never mutates a
 *   value it accepts, and open schemas preserve extras).
 *
 * Random candidates — rather than valid-then-mutated instances — keep the
 * oracle honest without hand-modelling each keyword's failure surface.
 */

type Rng = () => number

const KEYS = ['a', 'b', 'c', 'xs', 'zz'] as const
const SCALARS: readonly unknown[] = ['', 'v', 'hello', 'toolong', 0, 3, 7, -1, true, false, null]

/** A random JSON-ish value, biased toward the shapes the templates care about. */
const randomValue = (rng: Rng): unknown => {
  const k = rng()
  if (k < 0.55) return pick(rng, SCALARS)
  if (k < 0.85) {
    // An array of scalars, sometimes containing values ≥ 5 (matching `contains`).
    const n = Math.floor(rng() * 4)
    return Array.from({ length: n }, () => pick(rng, [1, 2, 5, 6, 9, 'x', 'y']))
  }
  // A small nested object.
  const out: Record<string, unknown> = {}
  for (const key of KEYS) if (rng() < 0.4) out[key] = pick(rng, SCALARS)
  return out
}

/** A random object candidate whose keys are drawn from the shared pool. */
const randomObject = (rng: Rng): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const key of KEYS) if (rng() < 0.6) out[key] = randomValue(rng)
  // Occasionally an out-of-pool key, to exercise propertyNames / extras.
  if (rng() < 0.3) out[pick(rng, ['A', 'longkey', 'x_1'])] = pick(rng, SCALARS)
  return out
}

type Template = { schema: Record<string, unknown>; candidate: (rng: Rng) => unknown }

const templates: ((rng: Rng) => Template)[] = [
  // contains / minContains / maxContains on a root array
  (rng) => {
    const min = pick(rng, [0, 1, 2])
    const max = pick(rng, [undefined, 2, 3])
    const schema: Record<string, unknown> = {
      type: 'array',
      contains: { type: 'number', minimum: 5 },
      minContains: min,
    }
    if (max !== undefined) schema['maxContains'] = max
    return {
      schema,
      candidate: (r) => Array.from({ length: Math.floor(r() * 6) }, () => pick(r, [1, 2, 4, 5, 6, 9, 'x'])),
    }
  },
  // contains on an object array property
  (rng) => ({
    schema: {
      type: 'object',
      properties: { xs: { type: 'array', items: { type: 'number' }, contains: { type: 'number', minimum: 5 } } },
      required: rng() < 0.5 ? ['xs'] : [],
    },
    candidate: randomObject,
  }),
  // dependentRequired
  () => ({
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      dependentRequired: { a: ['b'], b: ['c'] },
    },
    candidate: randomObject,
  }),
  // dependentSchemas (object subschema with required + typed property)
  () => ({
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      dependentSchemas: { a: { required: ['b'], properties: { b: { type: 'number' } } } },
    },
    candidate: randomObject,
  }),
  // dependentSchemas with a false branch
  () => ({
    schema: { type: 'object', properties: { a: { type: 'string' } }, dependentSchemas: { a: false } },
    candidate: randomObject,
  }),
  // propertyNames: pattern
  () => ({
    schema: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
    candidate: randomObject,
  }),
  // propertyNames: maxLength (type-less string constraint) with declared props
  () => ({
    schema: { type: 'object', properties: { a: { type: 'string' } }, propertyNames: { maxLength: 3 } },
    candidate: randomObject,
  }),
]

describe('keyword enforcement conformance vs ajv', () => {
  it('strict mode throws exactly when ajv rejects, and returns accepted values unchanged', { timeout: 60_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x1234567)
    const failures: string[] = []

    for (let i = 0; i < 1500 && failures.length < 8; i++) {
      const template = pick(rng, templates)(rng)
      const { schema, candidate } = template

      let check: (v: unknown) => boolean
      try {
        check = ajv.compile(schema)
      } catch {
        continue
      }

      const parse = evalGenerated<(input: unknown) => unknown>(
        generateFileParser(schema as never, 'Root', { strict: true }),
        'parseRoot',
      )

      for (let t = 0; t < 16 && failures.length < 8; t++) {
        const input = candidate(rng)
        const valid = check(input)
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
