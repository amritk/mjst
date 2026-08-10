import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { evaluateValidator } from './evaluate-generated.test-utils'
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
 *   - `unevaluatedProperties` / `unevaluatedItems`
 *   - the numeric keywords — `minimum` / `maximum` / `exclusive*` / `multipleOf`
 *
 * The numeric block is the newest and the one that shows why this file exists:
 * nothing pinned it, and the two implementations drifted apart twice over. The
 * emitted `multipleOf` kept a tolerance the interpreter had since tightened
 * (accepting `1000000.005` against `multipleOf: 0.01`), and the bounds were
 * emitted as direct failure conditions (`x < min`) where the interpreter negates
 * the pass condition (`!(x >= min)`) — identical for every ordinary value and
 * opposite for `NaN`. Neither divergence could show up in the conformance suite,
 * whose corpus is JSON and so holds no `NaN` and no value large enough to
 * overflow a quotient. Hence the deliberately hostile values below.
 *
 * The interpreter is the reference: it enforces all of these. For every schema ×
 * value pair the two must return the same valid/invalid verdict. Messages are a
 * separate concern — only the boolean verdict is the contract here.
 *
 * `unevaluated*` earns the most attention because the generator answers it in a
 * completely different way: the interpreter collects annotations as it walks,
 * while the generated code reconstructs the same answer as a flat expression. Two
 * implementations of one rule is exactly the situation where a shared oracle is
 * worth more than any number of hand-written expectations, so the cases below run
 * every applicator that publishes annotations — and a fuzz pass runs their
 * combinations.
 *
 * The schemas here are deliberately `$ref`-free: {@link evalValidator} compiles a
 * single function, and a `$ref` compiles to a call into a sibling file that only
 * exists in a full `buildValidatorSchema` output. `$ref` coverage lives in
 * `conformance.test.ts`, which links the whole generated set.
 */

/** Compiles both validators and asserts they agree on every value. */
const assertParity = (schema: Record<string, unknown>, values: readonly unknown[]): void => {
  const generated = evaluateValidator(generateValidatorFunction(schema as never, 'Root'))
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

/**
 * Values chosen to separate the two ways a numeric check can be written. The
 * ordinary numbers catch an off-by-one on the bound; `NaN` catches a bound
 * written as its failure condition rather than its negated pass condition; the
 * infinities and `1e308` catch a `multipleOf` whose quotient stops being finite.
 */
const NUMERIC_VALUES: unknown[] = [
  0,
  1,
  2,
  2.5,
  3,
  5,
  10,
  -1,
  -5,
  0.1,
  0.3,
  1000000.005,
  1234567.89,
  1e21,
  1e308,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.EPSILON,
  'not-a-number',
  null,
  true,
  {},
  [],
]

describe('generator/interpreter verdict parity', () => {
  it('agrees on the numeric bounds, including for NaN and the infinities', () => {
    for (const type of ['number', 'integer'] as const) {
      assertParity({ type, minimum: 2 }, NUMERIC_VALUES)
      assertParity({ type, maximum: 5 }, NUMERIC_VALUES)
      assertParity({ type, exclusiveMinimum: 2 }, NUMERIC_VALUES)
      assertParity({ type, exclusiveMaximum: 5 }, NUMERIC_VALUES)
      assertParity({ type, minimum: 2, maximum: 5 }, NUMERIC_VALUES)
      assertParity({ type, exclusiveMinimum: 0, exclusiveMaximum: 10 }, NUMERIC_VALUES)
      // Draft-04's boolean form: `exclusiveMinimum: true` makes the paired
      // `minimum` strict, so `2` fails where it passes above.
      assertParity({ type, minimum: 2, exclusiveMinimum: true }, NUMERIC_VALUES)
      assertParity({ type, maximum: 5, exclusiveMaximum: true }, NUMERIC_VALUES)
    }
    // A bare `type` with no bound accepts the non-finite values, as Ajv does —
    // the asymmetry is the point, so it is pinned rather than assumed.
    assertParity({ type: 'number' }, NUMERIC_VALUES)
    // Type-less: the bound binds its own family and ignores everything else.
    assertParity({ minimum: 2 }, NUMERIC_VALUES)
    assertParity({ exclusiveMaximum: 5 }, NUMERIC_VALUES)
  })

  it('agrees on multipleOf for integer, fractional, and overflowing divisors', () => {
    assertParity({ type: 'number', multipleOf: 2 }, NUMERIC_VALUES)
    assertParity({ type: 'number', multipleOf: 1 }, NUMERIC_VALUES)
    assertParity({ type: 'integer', multipleOf: 5 }, NUMERIC_VALUES)
    // The fractional divisors: `0.1` is the case the tolerance exists for (`0.3`
    // must pass), `0.01` the one it must not swallow (`1000000.005` must fail),
    // and `0.123456789` the one whose quotient overflows for `1e308`.
    assertParity({ type: 'number', multipleOf: 0.1 }, NUMERIC_VALUES)
    assertParity({ type: 'number', multipleOf: 0.01 }, NUMERIC_VALUES)
    assertParity({ type: 'number', multipleOf: 0.123456789 }, NUMERIC_VALUES)
    // Combined with a bound, which is how they appear in real schemas.
    assertParity({ type: 'number', minimum: 0, maximum: 100, multipleOf: 0.5 }, NUMERIC_VALUES)
    assertParity({ minimum: 0, multipleOf: 3 }, NUMERIC_VALUES)
  })

  it('agrees on the numeric keywords in the positions that compile differently', () => {
    // A bounded property, a bounded array item, and a bounded `propertyNames`
    // value each go through a different emitter — the per-property assertion, the
    // per-item boolean fast path, and the key loop — so each is checked.
    assertParity({ type: 'object', properties: { n: { type: 'number', minimum: 2, multipleOf: 0.1 } } }, [
      ...NUMERIC_VALUES.map((n) => ({ n })),
      {},
      'not-an-object',
    ])
    assertParity({ type: 'array', items: { type: 'number', minimum: 2, maximum: 5 } }, [
      ...NUMERIC_VALUES.map((n) => [n]),
      [],
      [2, 3, 4],
      [2, Number.NaN],
      'not-an-array',
    ])
    assertParity({ type: 'array', prefixItems: [{ type: 'number', exclusiveMinimum: 0 }] }, [
      ...NUMERIC_VALUES.map((n) => [n]),
      [],
    ])
  })

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

  it('agrees on unevaluatedProperties against the adjacent property keywords', () => {
    const values: unknown[] = [{}, { foo: 1 }, { bar: 1 }, { foo: 1, bar: 1 }, { 'x-a': 1 }, 42, 'str', null, [1]]
    assertParity({ properties: { foo: true }, unevaluatedProperties: false }, values)
    assertParity({ patternProperties: { '^x-': true }, unevaluatedProperties: false }, values)
    // A schema-form `additionalProperties` sweeps every key, so the unevaluated
    // keyword has nothing left to police — the generator must not invent work here.
    assertParity({ properties: { foo: true }, additionalProperties: true, unevaluatedProperties: false }, values)
    assertParity(
      { properties: { foo: true }, additionalProperties: { type: 'number' }, unevaluatedProperties: false },
      values,
    )
    // A schema-form unevaluated validates the leftovers instead of forbidding them.
    assertParity({ properties: { foo: true }, unevaluatedProperties: { type: 'string' } }, [
      ...values,
      { foo: 1, bar: 'ok' },
    ])
    // `propertyNames` inspects keys but evaluates nothing.
    assertParity({ propertyNames: { type: 'string' }, unevaluatedProperties: false }, values)
  })

  it('agrees on unevaluatedProperties across the in-place applicators', () => {
    const values: unknown[] = [{}, { a: 1 }, { b: 1 }, { a: 1, b: 1 }, { a: 1, b: 1, c: 1 }, { c: 1 }]
    assertParity(
      { allOf: [{ properties: { a: true } }, { properties: { b: true } }], unevaluatedProperties: false },
      values,
    )
    assertParity(
      {
        anyOf: [
          { required: ['a'], properties: { a: true } },
          { required: ['b'], properties: { b: true } },
        ],
        unevaluatedProperties: false,
      },
      values,
    )
    assertParity(
      {
        oneOf: [
          { required: ['a'], properties: { a: true } },
          { required: ['b'], properties: { b: true } },
        ],
        unevaluatedProperties: false,
      },
      values,
    )
    // A `not` discards its annotations, so nothing inside it counts as evaluated.
    assertParity({ not: { not: { properties: { a: true } } }, unevaluatedProperties: false }, values)
    // Cousins cannot see each other: the inner node's coverage is its own subtree.
    assertParity({ allOf: [{ properties: { a: true } }, { unevaluatedProperties: false }] }, values)
    // A nested unevaluated that is not `false` sweeps the leftovers itself.
    assertParity(
      { allOf: [{ properties: { a: true } }, { unevaluatedProperties: true }], unevaluatedProperties: false },
      values,
    )
  })

  it('agrees on unevaluatedProperties with if/then/else and dependentSchemas', () => {
    const values: unknown[] = [
      {},
      { foo: 'then' },
      { foo: 'then', bar: 1 },
      { foo: 'else' },
      { foo: 'else', baz: 'x' },
      { baz: 'x' },
    ]
    const ifSchema = { properties: { foo: { const: 'then' } }, required: ['foo'] }
    assertParity(
      {
        if: ifSchema,
        then: { properties: { bar: true } },
        else: { properties: { baz: true } },
        unevaluatedProperties: false,
      },
      values,
    )
    // `then` missing: only the `if` and `else` branches publish anything.
    assertParity({ if: ifSchema, else: { properties: { baz: true } }, unevaluatedProperties: false }, values)
    assertParity({ if: ifSchema, then: { properties: { bar: true } }, unevaluatedProperties: false }, values)
    // A bare `if` still publishes what it matched.
    assertParity({ if: { patternProperties: { foo: { type: 'string' } } }, unevaluatedProperties: false }, [
      ...values,
      { foo: 'a' },
      { bar: 'a' },
    ])
    assertParity(
      {
        properties: { foo2: {} },
        dependentSchemas: { foo: {}, foo2: { properties: { bar: {} } } },
        unevaluatedProperties: false,
      },
      [...values, { foo: '' }, { bar: '' }, { foo2: '', bar: '' }],
    )
  })

  it('agrees on unevaluatedItems against the adjacent array keywords', () => {
    const values: unknown[] = [[], ['a'], ['a', 1], ['a', 1, true], [1], 'not-array', 42, {}, null]
    assertParity({ prefixItems: [{ type: 'string' }], unevaluatedItems: false }, values)
    assertParity({ prefixItems: [{ type: 'string' }], items: true, unevaluatedItems: false }, values)
    assertParity({ prefixItems: [{ type: 'string' }], unevaluatedItems: { type: 'number' } }, values)
    assertParity({ items: { type: 'string' }, unevaluatedItems: false }, values)
    assertParity({ unevaluatedItems: { type: 'null' } }, [...values, [null], [null, null]])
    assertParity({ allOf: [{ prefixItems: [true] }, { unevaluatedItems: false }] }, values)
  })

  it('agrees on unevaluatedItems and contains, which publishes only what it matched', () => {
    // The distinction this pins down: the interpreter marks exactly the indices
    // `contains` matched, where Ajv marks the whole array. The generated term has
    // to look at the element, not the position.
    const values: unknown[] = [[], [1], ['a'], [1, 'a'], [1, 2], [1, 2, 'a'], ['a', 'b'], ['a', 0]]
    assertParity({ prefixItems: [true], contains: { type: 'string' }, unevaluatedItems: false }, values)
    assertParity({ contains: { type: 'string' }, minContains: 0, unevaluatedItems: false }, values)
    assertParity({ contains: { type: 'string' }, maxContains: 1, unevaluatedItems: false }, values)
    assertParity(
      {
        allOf: [{ contains: { multipleOf: 2 } }, { contains: { multipleOf: 3 } }],
        unevaluatedItems: { multipleOf: 5 },
      },
      [[2, 3, 4, 5, 6], [2, 3, 4, 7, 8], [2, 3], []],
    )
    // Nested `if`s over `contains`: each level's annotations ride on its own condition.
    assertParity(
      {
        if: { contains: { const: 'a' } },
        then: { if: { contains: { const: 'b' } }, then: { if: { contains: { const: 'c' } } } },
        unevaluatedItems: false,
      },
      [[], ['a', 'a'], ['a', 'b', 'a'], ['c', 'a', 'c', 'b'], ['b', 'b'], ['c', 'c'], ['c', 'b', 'c'], ['c', 'a', 'c']],
    )
  })

  it('agrees on unevaluated keywords nested inside another instance location', () => {
    // The annotations for one instance location say nothing about another: a
    // property's own unevaluated keyword sees only what that property's schema
    // evaluated, and an uncle branch that also visits it does not count.
    assertParity({ properties: { foo: { properties: { bar: true }, unevaluatedProperties: false } } }, [
      { foo: { bar: 1 } },
      { foo: { bar: 1, faz: 1 } },
      { foo: 1 },
      {},
    ])
    assertParity(
      {
        properties: { foo: { properties: { bar: true }, unevaluatedProperties: false } },
        anyOf: [{ properties: { foo: { properties: { faz: true } } } }],
      },
      [{ foo: { bar: 1 } }, { foo: { bar: 1, faz: 1 } }],
    )
    assertParity({ prefixItems: [{ prefixItems: [true, true], unevaluatedItems: false }], unevaluatedItems: false }, [
      [['a', 'b']],
      [['a', 'b'], 'c'],
      [['a', 'b', 'c']],
    ])
  })

  it('agrees on a constrained unevaluatedProperties reached through an array position', () => {
    // Each of these reaches the object through an accessor the emitter has to
    // bind before the coverage callback can read it, in all three array
    // spellings and under a dynamic key. `{ a: [{ p: 1, q: 2 }] }` is the
    // load-bearing one: a validator that quietly stopped checking the leftover
    // key would accept it, and the valid neighbour beside it rules out the
    // opposite failure of rejecting everything.
    const inner = { properties: { p: true }, unevaluatedProperties: { type: 'string' } }
    const objects = [{ a: [{ p: 1 }] }, { a: [{ p: 1, q: 'ok' }] }, { a: [{ p: 1, q: 2 }] }, { a: [] }, { a: 1 }, {}]

    assertParity({ type: 'object', properties: { a: { type: 'array', prefixItems: [inner] } } }, objects)
    assertParity({ type: 'object', properties: { a: { type: 'array', items: [inner] } } }, objects)
    assertParity({ type: 'object', properties: { a: { type: 'array', items: inner } } }, objects)
    assertParity({ type: 'object', patternProperties: { '^a': { type: 'array', items: [inner] } } }, objects)
    assertParity({ type: 'object', additionalProperties: { type: 'array', prefixItems: [inner] } }, objects)
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
        generated = evaluateValidator(generateValidatorFunction(schema as never, 'Root'))
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

  it('agrees across random unevaluated schemas and values', { timeout: 60_000 }, () => {
    const rng = makeRng(0x5eed)
    const divergences: string[] = []

    for (let si = 0; si < 500 && divergences.length < 10; si++) {
      const schema = randomUnevaluatedSchema(rng)
      let generated: (v: unknown) => unknown
      try {
        generated = evaluateValidator(generateValidatorFunction(schema as never, 'Root'))
      } catch (e) {
        // A refusal is a legitimate answer for a shape the flat form cannot see
        // through — but none of the shapes minted here is one, so it is a failure.
        divergences.push(`compile threw: ${(e as Error).message}\n  schema: ${JSON.stringify(schema)}`)
        continue
      }
      const interpreted = validate(schema as never)

      for (let t = 0; t < 24 && divergences.length < 10; t++) {
        const value = rng() < 0.5 ? randomUnevaluatedObject(rng) : randomUnevaluatedArray(rng)
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

/** Keys and elements small enough that random values collide often, which is what makes coverage interesting. */
const UNEVALUATED_KEYS = ['a', 'b', 'c']
const UNEVALUATED_ELEMENTS: unknown[] = ['s', 2, 3, true, null]

const randomUnevaluatedObject = (rng: () => number): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const key of UNEVALUATED_KEYS) {
    if (rng() < 0.5) out[key] = pick(rng, UNEVALUATED_ELEMENTS)
  }
  if (rng() < 0.3) out['x-extra'] = 1
  return out
}

const randomUnevaluatedArray = (rng: () => number): unknown[] =>
  Array.from({ length: Math.floor(rng() * 4) }, () => pick(rng, UNEVALUATED_ELEMENTS))

/** A property-shaped subschema that evaluates some of the keys, for the applicators to carry. */
const randomPropertyBranch = (rng: () => number): Record<string, unknown> => {
  const branch: Record<string, unknown> = { properties: { [pick(rng, UNEVALUATED_KEYS)]: true } }
  if (rng() < 0.5) branch['required'] = [pick(rng, UNEVALUATED_KEYS)]
  return branch
}

/** An array-shaped subschema, likewise. */
const randomItemBranch = (rng: () => number): Record<string, unknown> =>
  rng() < 0.5 ? { prefixItems: [true] } : { contains: { type: pick(rng, ['string', 'number', 'boolean']) } }

/**
 * A schema built out of the applicators that publish annotations, with an
 * `unevaluated*` keyword on top. Both keywords go on the same node so one random
 * value exercises the object and the array side of the same generated validator.
 */
const randomUnevaluatedSchema = (rng: () => number): Record<string, unknown> => {
  const s: Record<string, unknown> = {}
  if (rng() < 0.6) s['properties'] = { [pick(rng, UNEVALUATED_KEYS)]: true }
  if (rng() < 0.3) s['patternProperties'] = { '^x-': true }
  if (rng() < 0.4) s['prefixItems'] = [true]
  if (rng() < 0.3) s['contains'] = { type: pick(rng, ['string', 'number']) }
  if (rng() < 0.4) s['allOf'] = [rng() < 0.5 ? randomPropertyBranch(rng) : randomItemBranch(rng)]
  if (rng() < 0.4) s['anyOf'] = [randomPropertyBranch(rng), randomItemBranch(rng)]
  if (rng() < 0.25) s['oneOf'] = [randomPropertyBranch(rng), { required: ['x-extra'], properties: { 'x-extra': true } }]
  if (rng() < 0.3) {
    s['if'] = randomPropertyBranch(rng)
    if (rng() < 0.7) s['then'] = randomPropertyBranch(rng)
    if (rng() < 0.5) s['else'] = randomItemBranch(rng)
  }
  if (rng() < 0.25) s['dependentSchemas'] = { a: randomPropertyBranch(rng) }
  if (rng() < 0.2) s['not'] = { const: 'never-matches-anything' }
  s['unevaluatedProperties'] = rng() < 0.6 ? false : { type: pick(rng, ['string', 'number']) }
  s['unevaluatedItems'] = rng() < 0.6 ? false : { type: pick(rng, ['string', 'number']) }
  return s
}
