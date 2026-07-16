import { validate } from '@amritk/runtime-validators'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateValidatorFunction } from './generate-validator-function'

/**
 * Verdict parity between the *generated* validator and the runtime *interpreter*
 * for the keywords the generator historically under-enforced — leaving it
 * silently more permissive than `@amritk/runtime-validators` for the same
 * schema:
 *
 *   - `minProperties` / `maxProperties`
 *   - draft-07 dual-form `dependencies` (array + schema)
 *   - OpenAPI 3.0 `nullable: true`
 *   - full `propertyNames` subschemas (not just pattern/length/enum/const/$ref)
 *
 * The interpreter is the reference: it enforces all of these. For every schema ×
 * value pair the two must return the same valid/invalid verdict. Messages are a
 * separate concern — only the boolean verdict is the contract here.
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

/** Compiles both validators and asserts they agree on every value. */
const assertParity = (schema: Record<string, unknown>, values: readonly unknown[]): void => {
  const generated = evalValidator(generateValidatorFunction(schema as never, 'Root'))
  const interpreted = validate(schema as never)
  const divergences: string[] = []
  for (const value of values) {
    const gen = generated(value) === true
    const int = interpreted(value) === true
    if (gen !== int) {
      divergences.push(`value ${JSON.stringify(value)}: generated=${gen} interpreter=${int}`)
    }
  }
  expect(divergences, `schema ${JSON.stringify(schema)}\n${divergences.join('\n')}`).toEqual([])
}

describe('generator/interpreter verdict parity', () => {
  it('agrees on minProperties / maxProperties', () => {
    const values: unknown[] = [
      {},
      { a: 1 },
      { a: 1, b: 2 },
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 2, c: 3, d: 4 },
      'not-an-object',
      42,
      null,
      [1, 2, 3],
    ]
    assertParity({ type: 'object', minProperties: 2 }, values)
    assertParity({ type: 'object', maxProperties: 2 }, values)
    assertParity({ type: 'object', minProperties: 1, maxProperties: 3 }, values)
    assertParity({ type: 'object', properties: { id: { type: 'number' } }, required: ['id'], minProperties: 2 }, [
      ...values,
      { id: 1 },
      { id: 1, extra: true },
    ])
  })

  it('agrees on draft-07 dependencies (array + schema + boolean forms)', () => {
    const values = [
      {},
      { a: 1 },
      { a: 1, b: 2 },
      { a: 1, b: 2, c: 3 },
      { b: 2 },
      { creditCard: 'x' },
      { creditCard: 'x', billing: 'addr' },
      { creditCard: 'x', billing: 42 },
      null,
      'x',
    ]
    // Array form: `a` requires both `b` and `c`.
    assertParity({ type: 'object', dependencies: { a: ['b', 'c'] } }, values)
    // Schema form: presence of `a` demands the object also satisfy the subschema.
    assertParity({ type: 'object', dependencies: { a: { required: ['c'] } } }, values)
    assertParity(
      {
        type: 'object',
        dependencies: {
          creditCard: { properties: { billing: { type: 'string' } }, required: ['billing'] },
        },
      },
      values,
    )
    // Boolean subschema: `a`'s mere presence is invalid.
    assertParity({ type: 'object', dependencies: { a: false } }, values)
  })

  it('agrees on OpenAPI nullable: true (scalar, object, property, nested, enum)', () => {
    assertParity({ type: 'string', nullable: true }, ['s', null, 42, true, {}])
    assertParity({ type: 'integer', nullable: true, minimum: 0 }, [0, 5, -1, 1.5, null, 'x'])
    assertParity({ enum: ['a', 'b'], nullable: true }, ['a', 'b', 'c', null, 1])
    assertParity({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], nullable: true }, [
      null,
      { a: 'x' },
      {},
      { a: 1 },
      'not-object',
    ])
    // Property-level nullable: the value may be its type OR null, but absence of a
    // required prop still fails.
    assertParity({ type: 'object', properties: { name: { type: 'string', nullable: true } }, required: ['name'] }, [
      { name: 'x' },
      { name: null },
      { name: 42 },
      {},
    ])
    // Nested nullable object.
    assertParity(
      {
        type: 'object',
        properties: {
          addr: { type: 'object', nullable: true, properties: { city: { type: 'string' } }, required: ['city'] },
        },
      },
      [{ addr: null }, { addr: { city: 'NYC' } }, { addr: {} }, { addr: { city: 1 } }, {}],
    )
  })

  it('agrees on required properties with an empty or boolean-true schema', () => {
    // `{ a: undefined }` is intentionally excluded: it is not representable JSON,
    // and there the generated `'a' in obj` and the interpreter's `!== undefined`
    // presence tests legitimately differ (a separate, deferred concern).
    const values = [{}, { a: 1 }, { a: null }, { a: 'x' }, 'not-object', null]
    // An empty `{}` property schema accepts any value, but the key must be present.
    assertParity({ type: 'object', properties: { a: {} }, required: ['a'] }, values)
    // A boolean `true` property schema is likewise accept-anything-but-present.
    assertParity({ type: 'object', properties: { a: true }, required: ['a'] }, values)
    // Optional empty/true schemas impose nothing.
    assertParity({ type: 'object', properties: { a: {} } }, values)
    assertParity({ type: 'object', properties: { a: true } }, values)
  })

  it('agrees on a root scalar type combined with a combinator', () => {
    assertParity({ type: 'string', not: { const: 'x' } }, ['y', 'x', 42, null, true])
    assertParity({ type: 'number', minimum: 10, allOf: [{ maximum: 100 }] }, [50, 5, 200, 'abc', null])
    assertParity({ type: 'string', minLength: 2, anyOf: [{ maxLength: 4 }, { const: 'longer' }] }, [
      'ab',
      'a',
      'abcde',
      'longer',
      42,
    ])
  })

  it('agrees on items: false (array must be empty)', () => {
    assertParity({ type: 'array', items: false }, [[], [1], [1, 2], 'not-array', null])
    // With prefixItems, items:false caps the length instead of forbidding all.
    assertParity({ type: 'array', prefixItems: [{ type: 'string' }], items: false }, [[], ['a'], ['a', 'b'], [1]])
  })

  it('agrees on full propertyNames subschemas (beyond the pattern/length subset)', () => {
    const values = [
      {},
      { ab: 1 },
      { abc: 1 },
      { A: 1 },
      { a: 1, bb: 2 },
      { forbidden: 1 },
      { allowed: 1 },
      { toolongkey: 1 },
      { '': 1 },
    ]
    assertParity({ type: 'object', propertyNames: { type: 'string', minLength: 2 } }, values)
    assertParity({ type: 'object', propertyNames: { not: { const: 'forbidden' } } }, values)
    assertParity({ type: 'object', propertyNames: { anyOf: [{ const: 'a' }, { const: 'bb' }] } }, values)
    assertParity({ type: 'object', propertyNames: { pattern: '^[a-z]+$', maxLength: 4 } }, values)
    // A number-typed propertyNames rejects every key (keys are always strings).
    assertParity({ type: 'object', propertyNames: { type: 'number' } }, values)
  })
})

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

const KEYS = ['a', 'b', 'c', 'x-foo', 'id', 'name']
const LEAVES = ['s', 'ab', 2, 0, true, null]

const randomValue = (rng: () => number, depth: number): unknown => {
  const p = rng()
  if (depth <= 0 || p < 0.5) return pick(rng, LEAVES)
  if (p < 0.62) return Array.from({ length: Math.floor(rng() * 3) }, () => randomValue(rng, depth - 1))
  const out: Record<string, unknown> = {}
  const n = Math.floor(rng() * 4)
  for (let i = 0; i < n; i++) out[pick(rng, KEYS)] = randomValue(rng, depth - 1)
  return out
}

/** A schema that combines the four keyword groups so their interactions are covered too. */
const randomSchema = (rng: () => number): Record<string, unknown> => {
  const s: Record<string, unknown> = { type: 'object' }
  if (rng() < 0.6) {
    const props: Record<string, unknown> = {}
    const n = Math.floor(rng() * 3)
    for (let i = 0; i < n; i++) {
      const t = pick(rng, ['string', 'number', 'boolean'])
      props[pick(rng, KEYS)] = rng() < 0.4 ? { type: t, nullable: true } : { type: t }
    }
    s.properties = props
  }
  if (rng() < 0.3) s.required = [pick(rng, KEYS)]
  if (rng() < 0.4) s.minProperties = Math.floor(rng() * 3)
  if (rng() < 0.4) s.maxProperties = 1 + Math.floor(rng() * 3)
  if (rng() < 0.4) {
    s.dependencies = rng() < 0.5 ? { a: ['b'] } : { a: { required: ['c'] } }
  }
  if (rng() < 0.3) s.propertyNames = pick(rng, [{ pattern: '^[a-z]' }, { minLength: 2 }, { not: { const: 'id' } }])
  if (rng() < 0.2) s.nullable = true
  return s
}

describe('generator/interpreter fuzz parity', () => {
  it('agrees across random schemas and values combining the four keyword groups', { timeout: 60_000 }, () => {
    const rng = makeRng(0x9e37)
    const divergences: string[] = []

    for (let si = 0; si < 400 && divergences.length < 10; si++) {
      const schema = randomSchema(rng)
      let generated: (v: unknown) => unknown
      try {
        generated = evalValidator(generateValidatorFunction(schema as never, 'Root'))
      } catch (e) {
        divergences.push(`compile threw: ${(e as Error).message}\n  schema: ${JSON.stringify(schema)}`)
        continue
      }
      const interpreted = validate(schema as never)

      for (let t = 0; t < 30 && divergences.length < 10; t++) {
        const value = randomValue(rng, 2)
        let gen: boolean
        try {
          gen = generated(value) === true
        } catch (e) {
          divergences.push(
            `threw: ${(e as Error).message}\n  schema: ${JSON.stringify(schema)}\n  value: ${JSON.stringify(value)}`,
          )
          break
        }
        if (gen !== (interpreted(value) === true)) {
          divergences.push(
            `schema: ${JSON.stringify(schema)}\n  value: ${JSON.stringify(value)}\n  generated=${gen} interpreter=${!gen}`,
          )
        }
      }
    }

    expect(divergences, divergences.join('\n\n')).toEqual([])
  })
})
