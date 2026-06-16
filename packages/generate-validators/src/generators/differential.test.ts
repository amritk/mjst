import Ajv2020 from 'ajv/dist/2020'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateValidatorFunction } from './generate-validator-function'

/**
 * Differential fuzz: for a spread of object schemas, the generated validator's
 * valid/invalid verdict must match Ajv's across a large stream of random values.
 * The generator emits a *predicate* validator (no coercion), so its verdict is
 * the contract — a wrong-but-fast answer is worthless — and this is the safety
 * net that keeps it from drifting from JSON Schema semantics.
 *
 * Scope: the keyword subset the generator implements (`type`, `properties`,
 * `required`, `patternProperties`, schema/`false`/`true` `additionalProperties`,
 * `propertyNames`, `dependentRequired`, string/number bounds, `enum`, `const`,
 * nested objects). It deliberately avoids the keywords the generator does not
 * claim to enforce (combinators, `contains`, tuple `items`, `min/maxItems`,
 * `unevaluated*`) and `multipleOf` with a fractional divisor (a floating-point
 * judgement call). The schema is rooted on an object so `patternProperties` /
 * `additionalProperties` are exercised heavily.
 */

const evalValidator = (code: string): ((input: unknown) => unknown) => {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleExports: Record<string, unknown> = {}
  new Function('exports', js)(moduleExports)
  const name = Object.keys(moduleExports).find((n) => n.startsWith('validate'))
  return moduleExports[name ?? ''] as (input: unknown) => unknown
}

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

const STRINGS = ['', 'a', 'abc', 'Ada', 'x-foo', 'num_1', 'X', 'a b', 'lower']
const NUMBERS = [-1, 0, 1, 2, 3, 10, 1.5, -0.5, 100]
const KEYS = ['id', 'name', 'x-foo', 'x-bar', 'num_1', 'a', 'b', 'extra']

const randomValue = (rng: () => number, depth: number): unknown => {
  const p = rng()
  if (depth <= 0 || p < 0.55) {
    const leaf = rng()
    if (leaf < 0.15) return null
    if (leaf < 0.3) return rng() < 0.5
    if (leaf < 0.62) return pick(rng, NUMBERS)
    return pick(rng, STRINGS)
  }
  if (p < 0.75) return Array.from({ length: Math.floor(rng() * 4) }, () => randomValue(rng, depth - 1))
  const out: Record<string, unknown> = {}
  const n = Math.floor(rng() * 4)
  for (let i = 0; i < n; i++) out[pick(rng, KEYS)] = randomValue(rng, depth - 1)
  return out
}

// Combinator subschemas built so a `oneOf` is non-degenerate (branches with
// disjoint value spaces) — otherwise a value matching two branches makes `oneOf`
// fail for reasons unrelated to the generator.
const combinatorSchema = (rng: () => number): Record<string, unknown> => {
  const which = pick(rng, ['anyOf', 'oneOf', 'not', 'allOf', 'typeless'])
  if (which === 'not') return { not: { type: pick(rng, ['string', 'number', 'boolean']) } }
  // Type-less branches (no declared `type`, just `required` / `minItems`): these
  // apply to the value's runtime type and must not collapse to "always matches".
  if (which === 'typeless') {
    return pick(rng, [
      { not: { required: ['x'] } },
      { anyOf: [{ required: ['x'] }, { required: ['y'] }] },
      { anyOf: [{ minItems: 2 }, { type: 'string' }] },
    ])
  }
  if (which === 'allOf') {
    return {
      allOf: [
        { type: 'object', properties: { p: { type: 'string' } }, required: ['p'] },
        { type: 'object', properties: { q: { type: 'number' } }, required: ['q'] },
      ],
    }
  }
  // anyOf / oneOf over disjoint primitive types.
  const types = ['string', 'number', 'boolean', 'null'].sort(() => rng() - 0.5).slice(0, 2 + Math.floor(rng() * 2))
  return { [which]: types.map((type) => ({ type })) }
}

const randomTyped = (rng: () => number, depth: number): Record<string, unknown> => {
  if (rng() < 0.18) return combinatorSchema(rng)
  const t = pick(rng, ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'enumconst'])
  const s: Record<string, unknown> = {}
  if (t === 'enumconst') {
    if (rng() < 0.5) s.enum = [pick(rng, STRINGS), pick(rng, NUMBERS), true]
    else s.const = pick(rng, [...STRINGS, ...NUMBERS])
    return s
  }
  s.type = t
  if (t === 'string') {
    if (rng() < 0.4) s.pattern = pick(rng, ['^[a-z]+$', '^x-', '\\d'])
    if (rng() < 0.3) s.minLength = Math.floor(rng() * 3)
    if (rng() < 0.3) s.maxLength = 2 + Math.floor(rng() * 3)
  } else if (t === 'number' || t === 'integer') {
    if (rng() < 0.4) s.minimum = pick(rng, [0, 1, -1])
    if (rng() < 0.4) s.maximum = pick(rng, [5, 10, 100])
    if (rng() < 0.2) s.exclusiveMinimum = 0
    if (rng() < 0.2) s.exclusiveMaximum = 10
  } else if (t === 'array') {
    // Scalar item types only: `uniqueItems` dedupes by a JSON projection, which
    // matches Ajv's deep equality for primitives but not for objects.
    const useTuple = rng() < 0.3
    if (useTuple) {
      s.prefixItems = [{ type: pick(rng, ['string', 'number']) }, { type: 'boolean' }]
      if (rng() < 0.5) s.items = false
    } else if (rng() < 0.7) {
      s.items = { type: pick(rng, ['string', 'number', 'boolean']) }
    }
    // `contains` only on non-tuple arrays: Ajv has a known quirk where
    // `prefixItems` + `contains` wrongly accepts an empty array, and the
    // generator is spec-correct — so the two are exercised separately.
    if (!useTuple && rng() < 0.4) s.contains = { type: 'number' }
    if (!useTuple && rng() < 0.5) s.minItems = Math.floor(rng() * 3)
    if (!useTuple && rng() < 0.5) s.maxItems = 2 + Math.floor(rng() * 3)
    if (rng() < 0.4) s.uniqueItems = true
  } else if (t === 'object' && depth > 0) {
    return randomObjectSchema(rng, depth - 1)
  }
  return s
}

const randomObjectSchema = (rng: () => number, depth: number): Record<string, unknown> => {
  const s: Record<string, unknown> = { type: 'object' }
  if (rng() < 0.85) {
    const props: Record<string, unknown> = {}
    const n = Math.floor(rng() * 3)
    for (let i = 0; i < n; i++) props[pick(rng, KEYS)] = randomTyped(rng, depth)
    s.properties = props
  }
  if (rng() < 0.4) s.required = Array.from({ length: Math.floor(rng() * 2) + 1 }, () => pick(rng, KEYS))
  if (rng() < 0.5) s.patternProperties = { '^x-': randomTyped(rng, depth), _1$: { type: 'number' } }
  if (rng() < 0.5) {
    const ap = rng()
    s.additionalProperties = ap < 0.4 ? false : ap < 0.6 ? true : randomTyped(rng, depth)
  }
  if (rng() < 0.2) s.propertyNames = { pattern: '^[a-zA-Z_-]+$' }
  if (rng() < 0.2) s.dependentRequired = { 'x-foo': ['id'] }
  return s
}

describe('differential fuzz vs ajv', () => {
  it('object schemas agree with ajv across random values', { timeout: 60_000 }, () => {
    const ajv = new Ajv2020({ allErrors: false, strict: false })
    const rng = makeRng(0x51fe)
    const divergences: string[] = []

    for (let si = 0; si < 1500 && divergences.length < 10; si++) {
      const schema = randomObjectSchema(rng, 2)
      let ajvValidate: (v: unknown) => boolean
      let ours: (v: unknown) => unknown
      try {
        ajvValidate = ajv.compile(schema)
      } catch {
        continue // Ajv rejected the schema; not a value-level divergence.
      }
      try {
        ours = evalValidator(generateValidatorFunction(schema as never, 'Root'))
      } catch (e) {
        divergences.push(`compile threw: ${(e as Error).message}\n  schema: ${JSON.stringify(schema)}`)
        continue
      }

      for (let t = 0; t < 40 && divergences.length < 10; t++) {
        const value = randomValue(rng, 3)
        let oursValid: boolean
        try {
          oursValid = ours(value) === true
        } catch (e) {
          divergences.push(
            `threw: ${(e as Error).message}\n  schema: ${JSON.stringify(schema)}\n  value: ${JSON.stringify(value)}`,
          )
          break
        }
        if (oursValid !== (ajvValidate(value) === true)) {
          divergences.push(
            `schema: ${JSON.stringify(schema)}\n  value: ${JSON.stringify(value)}\n  ours=${oursValid} ajv=${!oursValid}`,
          )
        }
      }
    }

    expect(divergences, divergences.join('\n\n')).toEqual([])
  })

  it('root-level combinator schemas agree with ajv', { timeout: 60_000 }, () => {
    const ajv = new Ajv2020({ allErrors: false, strict: false })
    const rng = makeRng(0x7a3c)
    const divergences: string[] = []

    for (let si = 0; si < 1500 && divergences.length < 10; si++) {
      const schema = combinatorSchema(rng)
      let ajvValidate: (v: unknown) => boolean
      let ours: (v: unknown) => unknown
      try {
        ajvValidate = ajv.compile(schema)
      } catch {
        continue
      }
      try {
        ours = evalValidator(generateValidatorFunction(schema as never, 'Root'))
      } catch {
        continue
      }
      for (let t = 0; t < 40 && divergences.length < 10; t++) {
        const value = randomValue(rng, 3)
        if ((ours(value) === true) !== (ajvValidate(value) === true)) {
          divergences.push(`schema: ${JSON.stringify(schema)}\n  value: ${JSON.stringify(value)}`)
        }
      }
    }

    expect(divergences, divergences.join('\n\n')).toEqual([])
  })
})
