import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser, makeRng, pick } from './differential.test-utils'

/**
 * Differential fuzz for the *coercing* (default) parser mode, with Ajv as the
 * oracle for one property: whatever a coercing parser hands back must be a valid
 * instance of the schema that produced it. That is the whole contract — the
 * parser repairs rather than rejects — and the sibling strict fuzzers cannot see
 * it, because they only ever assert on accept/reject.
 *
 * It found four ways a "repair" was itself invalid: a `""` fallback for a
 * `minLength` string, a `0` fallback for a bounded number, a `String(x)` /
 * `Number(x)` coercion that cleared its `typeof` test but not the schema's
 * bounds, a bare `[]` for an array with `minItems`, and a `const` array item
 * whose elements were passed through untouched.
 *
 * Inputs are arbitrary junk rather than mutated valid values: the coercion path
 * is exactly the one a valid value never takes.
 */

type Rng = () => number
type SchemaNode = Record<string, unknown>
const KEYS = ['id', 'name', 'x-a', 'a b']

const leaf = (rng: Rng): SchemaNode => {
  const k = rng()
  if (k < 0.12) return { type: 'string', enum: ['a', 'b', 'c'] }
  if (k < 0.2) return { type: 'number', enum: [1, 2, 3] }
  if (k < 0.26) return { const: pick(rng, ['a', 1, true, null]) }
  if (k < 0.34) return { type: 'string', minLength: 1, maxLength: 4 }
  if (k < 0.42) return { type: 'integer', minimum: 0, maximum: 10 }
  if (k < 0.5) return { type: ['string', 'null'] }
  return { type: pick(rng, ['string', 'number', 'integer', 'boolean', 'null']) }
}

const genObject = (rng: Rng, depth: number): SchemaNode => {
  const properties: Record<string, SchemaNode> = {}
  const declared: string[] = []
  const n = 1 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const key = pick(rng, KEYS)
    if (Object.hasOwn(properties, key)) continue
    properties[key] = genValue(rng, depth - 1)
    declared.push(key)
  }
  const required = rng() < 0.5 ? declared : declared.filter(() => rng() < 0.6)
  const schema: SchemaNode = { type: 'object', properties }
  if (required.length > 0) schema['required'] = required
  if (rng() < 0.3) schema['additionalProperties'] = false
  return schema
}

const genValue = (rng: Rng, depth: number): SchemaNode => {
  if (depth <= 0) return leaf(rng)
  const k = rng()
  if (k < 0.35) return genObject(rng, depth)
  if (k < 0.5) return { type: 'array', items: rng() < 0.5 ? genObject(rng, depth - 1) : leaf(rng) }
  if (k < 0.56) return { anyOf: [leaf(rng), { type: 'boolean' }] }
  return leaf(rng)
}

/** Arbitrary junk, so the parser has to repair rather than pass through. */
const junk = (rng: Rng, depth = 2): unknown => {
  const k = rng()
  if (k < 0.1) return undefined
  if (k < 0.2) return null
  if (k < 0.3) return pick(rng, ['', 'x', 'ABC', '1'])
  if (k < 0.4) return pick(rng, [0, -1, 1.5, 99])
  if (k < 0.45) return rng() < 0.5
  if (k < 0.6 && depth > 0) return Array.from({ length: Math.floor(rng() * 3) }, () => junk(rng, depth - 1))
  if (depth > 0) {
    const out: Record<string, unknown> = {}
    const n = Math.floor(rng() * 3)
    for (let i = 0; i < n; i++) out[pick(rng, [...KEYS, 'zz'])] = junk(rng, depth - 1)
    return out
  }
  return 'leaf'
}

describe('coercing parser output is valid against its own schema', () => {
  for (const seed of [0x11, 0x22, 0x33, 0x44]) {
    it(`repairs arbitrary input into a valid instance (seed ${seed})`, { timeout: 300_000 }, () => {
      const ajv = new Ajv({ strict: false, allErrors: false, ownProperties: true })
      const rng = makeRng(seed)
      const failures: string[] = []

      for (let i = 0; i < 800 && failures.length < 5; i++) {
        const schema = genObject(rng, 3)
        let check: (v: unknown) => boolean
        try {
          check = ajv.compile(structuredClone(schema))
        } catch {
          continue
        }
        let parse: (input: unknown) => unknown
        try {
          parse = evalGenerated<(input: unknown) => unknown>(generateFileParser(schema as never, 'Root'), 'parseRoot')
        } catch (e) {
          failures.push(`GENERATION FAILED: ${(e as Error).message.slice(0, 300)}\n  schema: ${JSON.stringify(schema)}`)
          continue
        }

        for (let t = 0; t < 6 && failures.length < 5; t++) {
          const input = junk(rng)
          let output: unknown
          try {
            output = parse(structuredClone(input))
          } catch (e) {
            failures.push(
              `coercing parser THREW\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}\n  ${(e as Error).message}`,
            )
            continue
          }
          if (!check(structuredClone(output))) {
            failures.push(
              `coerced output is invalid\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}\n  output: ${JSON.stringify(output)}\n  ajv: ${JSON.stringify(ajv.errors?.slice(0, 2))}`,
            )
          }
        }
      }
      expect(failures, failures.join('\n\n')).toEqual([])
    })
  }
})
