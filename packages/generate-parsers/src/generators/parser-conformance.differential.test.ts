import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, KEYS, makeRng, pick } from './differential.test-utils'
import { generateParserFunction } from './generate-parser-function'

/**
 * The coercing parser's contract is that its output is a valid instance of the
 * generated TypeScript type. This fuzzes shape-only schemas (no value
 * constraints) and asserts the coerced output conforms to the schema's *shape*
 * with Ajv: type, `enum`, `const`, object `properties`/`required`, scalar
 * unions, and array items with scalar, enum, or inline-object schemas (those
 * elements are deeply coerced via the element map or a private item
 * sub-parser). Items that are unions, `const`s, or nested arrays are still
 * passed through, so the oracle drops those `items` (the array only has to be
 * an array). Extra object keys are allowed (the coercer keeps them), so
 * `additionalProperties: false` is never generated.
 */

const leaf = (rng: () => number): Record<string, unknown> => {
  const k = rng()
  if (k < 0.18) return { type: 'string', enum: ['a', 'b', 'c'] }
  if (k < 0.3) return { const: pick(rng, ['fixed', 7, true]) }
  if (k < 0.4) return { type: 'number', enum: [1, 2, 3] }
  return { type: pick(rng, ['string', 'number', 'integer', 'boolean', 'null']) }
}

// Distinct-typed union branches so a `oneOf` is never degenerate.
const unionBranches = (rng: () => number): Record<string, unknown>[] => {
  const types = ['string', 'number', 'boolean'].sort(() => rng() - 0.5)
  const n = 2 + Math.floor(rng() * 2)
  return types.slice(0, Math.min(n, 3)).map((type) => ({ type }))
}

const gen = (rng: () => number, depth: number): Record<string, unknown> => {
  if (depth <= 0) return leaf(rng)
  const k = rng()
  if (k < 0.22) return { [pick(rng, ['anyOf', 'oneOf'])]: unionBranches(rng) }
  if (k < 0.55) {
    const s: Record<string, unknown> = { type: 'object', properties: {} }
    const props = s['properties'] as Record<string, unknown>
    const n = 1 + Math.floor(rng() * 3)
    const req: string[] = []
    for (let i = 0; i < n; i++) {
      const key = pick(rng, KEYS)
      props[key] = gen(rng, depth - 1)
      if (rng() < 0.6) req.push(key)
    }
    if (req.length > 0) s['required'] = [...new Set(req)]
    return s
  }
  if (k < 0.75) return { type: 'array', items: gen(rng, depth - 1) }
  return leaf(rng)
}

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

const isScalarItems = (items: unknown): boolean =>
  items !== null &&
  typeof items === 'object' &&
  !Array.isArray(items) &&
  SCALAR_TYPES.has((items as Record<string, unknown>)['type'] as string) &&
  !('enum' in (items as object))

const isEnumItems = (items: unknown): boolean =>
  items !== null && typeof items === 'object' && !Array.isArray(items) && 'enum' in (items as object)

const isInlineObjectItems = (items: unknown): boolean =>
  items !== null &&
  typeof items === 'object' &&
  !Array.isArray(items) &&
  (items as Record<string, unknown>)['type'] === 'object' &&
  'properties' in (items as object)

/**
 * The shape oracle: treat `integer` as `number` (the generated TS type is
 * `number`). Array `items` are kept when their elements are deeply coerced —
 * a single scalar type or enum (element map) or an inline object (private
 * item sub-parser) — and dropped otherwise (union / `const` / nested-array
 * element values are not coerced and are out of scope).
 */
const shapeOracle = (schema: unknown): unknown => {
  if (schema === null || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(shapeOracle)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'prefixItems') continue
    if (key === 'items' && !isScalarItems(value) && !isEnumItems(value) && !isInlineObjectItems(value)) continue
    out[key] = key === 'type' && value === 'integer' ? 'number' : shapeOracle(value)
  }
  return out
}

const randVal = (rng: () => number, depth: number): unknown => {
  const p = rng()
  if (depth <= 0 || p < 0.5) {
    const l = rng()
    if (l < 0.2) return null
    if (l < 0.4) return rng() < 0.5
    if (l < 0.7) return pick(rng, [0, 1, 2, 7, 9, -1, 1.5])
    return pick(rng, ['', 'a', 'z', 'fixed', 'hello'])
  }
  if (p < 0.75) return Array.from({ length: Math.floor(rng() * 4) }, () => randVal(rng, depth - 1))
  const o: Record<string, unknown> = {}
  const n = Math.floor(rng() * 4)
  for (let i = 0; i < n; i++) o[pick(rng, KEYS)] = randVal(rng, depth - 1)
  return o
}

describe('parser coercion conformance vs ajv', () => {
  it('coerced output is a valid instance of the schema shape', { timeout: 60_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x6c0d)
    const failures: string[] = []

    for (let i = 0; i < 3000 && failures.length < 8; i++) {
      const schema = gen(rng, 3)
      let check: (v: unknown) => boolean
      try {
        check = ajv.compile(shapeOracle(schema) as object)
      } catch {
        continue
      }
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(schema as never, 'Root'),
        'parseRoot',
      )
      for (let t = 0; t < 8 && failures.length < 8; t++) {
        const input = randVal(rng, 3)
        let output: unknown
        try {
          output = parse(input)
        } catch (e) {
          failures.push(
            `threw: ${(e as Error).message}\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}`,
          )
          break
        }
        if (check(output) !== true) {
          failures.push(
            `schema: ${JSON.stringify(schema)}\n  input:  ${JSON.stringify(input)}\n  output: ${JSON.stringify(output)}`,
          )
        }
      }
    }

    expect(failures, failures.join('\n\n')).toEqual([])
  })
})
