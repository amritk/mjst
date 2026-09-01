import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser } from './differential.test-utils'

/**
 * Verdict parity between a *generated strict parser* and the runtime
 * *interpreter* for the numeric keywords, over values a JSON corpus cannot hold.
 *
 * This file exists because of a gap, not a bug. Every other differential suite
 * here fuzzes against Ajv over inputs built from the schema — and those inputs
 * are JSON, so they contain no `NaN`, no `±Infinity`, and no value large enough
 * to overflow a `multipleOf` quotient. The numeric rules are precisely the ones
 * whose two spellings differ *only* on those values:
 *
 *   - A bound written as a failure condition (`x < min`) and a bound written as
 *     a negated pass condition (`!(x >= min)`) agree on every ordinary number
 *     and are opposite for `NaN`, which compares `false` against every operator.
 *     The interpreter negates the pass condition, so `NaN` fails a bound; a
 *     generator spelled the other way is silently more permissive.
 *   - `multipleOf` answers integer and fractional divisors differently, and the
 *     fractional path's tolerance has to track the quotient's own representation
 *     error rather than a fixed epsilon.
 *
 * `@amritk/generate-validators` drifted from the interpreter on exactly these
 * two points and now pins them in its own `interpreter-parity.test.ts`. This
 * package emits the same checks from the same shared helpers
 * (`@amritk/helpers/numeric-bound-check`, `@amritk/helpers/multiple-of-check`)
 * and had nothing holding it to them, which is the whole reason the helpers are
 * shared: the emitters agree by construction, and this asserts that the thing
 * they construct still agrees with the interpreter.
 *
 * The interpreter is the reference. Strict mode is the surface under test
 * because it is the one with an accept/reject contract — it throws where the
 * interpreter reports invalid — whereas the lax parser coerces rather than
 * judging. Only the boolean verdict is the contract here; messages are a
 * separate concern.
 */

/**
 * Values chosen for the property that no JSON document can carry them, plus the
 * ordinary boundary numbers that keep the comparison honest in both directions.
 */
const HOSTILE_NUMBERS = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  0,
  -0,
  1,
  -1,
  5,
  10,
  10.5,
  1e21,
  Number.MAX_SAFE_INTEGER,
  1000000.005,
  0.3,
  1234567.89,
]

/** Runs a strict parser and the interpreter over every value, comparing verdicts. */
const assertParity = (schema: Record<string, unknown>, values: readonly unknown[]): void => {
  const parse = evalGenerated<(input: unknown) => unknown>(
    generateFileParser(schema as never, 'Root', { strict: true }),
    'parseRoot',
  )
  const interpreted = validate(schema as never)
  const divergences: string[] = []
  for (const value of values) {
    let generated: boolean
    try {
      parse(value)
      generated = true
    } catch {
      generated = false
    }
    const interpreter = interpreted(value) === true
    if (generated !== interpreter) {
      divergences.push(`value ${String(value)}: parser=${generated} interpreter=${interpreter}`)
    }
  }
  expect(divergences, `schema ${JSON.stringify(schema)}\n${divergences.join('\n')}`).toEqual([])
}

describe('interpreter-parity', () => {
  it('agrees on minimum, including NaN', () => {
    assertParity({ type: 'number', minimum: 0 }, HOSTILE_NUMBERS)
  })

  it('agrees on maximum, including NaN', () => {
    assertParity({ type: 'number', maximum: 10 }, HOSTILE_NUMBERS)
  })

  it('agrees on exclusiveMinimum and exclusiveMaximum', () => {
    assertParity({ type: 'number', exclusiveMinimum: 0 }, HOSTILE_NUMBERS)
    assertParity({ type: 'number', exclusiveMaximum: 10 }, HOSTILE_NUMBERS)
  })

  it('agrees on a bounded range', () => {
    assertParity({ type: 'number', minimum: 0, maximum: 10 }, HOSTILE_NUMBERS)
    assertParity({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 }, HOSTILE_NUMBERS)
  })

  it('agrees on bounds under `integer`, where Number.isInteger also screens non-finite values', () => {
    assertParity({ type: 'integer', minimum: 0 }, HOSTILE_NUMBERS)
    assertParity({ type: 'integer', minimum: 0, maximum: 10 }, HOSTILE_NUMBERS)
  })

  it('agrees on an integer multipleOf, including values that overflow a quotient', () => {
    assertParity({ type: 'number', multipleOf: 1 }, HOSTILE_NUMBERS)
    assertParity({ type: 'number', multipleOf: 2 }, HOSTILE_NUMBERS)
  })

  it('agrees on a fractional multipleOf, where a fixed epsilon would be wrong', () => {
    // `0.3` against `multipleOf: 0.1` is the float-wrong case (`0.3 % 0.1` is
    // `0.0999…`); `1000000.005` against `0.01` is the too-loose-tolerance case.
    assertParity({ type: 'number', multipleOf: 0.1 }, HOSTILE_NUMBERS)
    assertParity({ type: 'number', multipleOf: 0.01 }, HOSTILE_NUMBERS)
  })

  it('agrees when the numeric keywords sit on an object property', () => {
    const schema = {
      type: 'object',
      properties: { n: { type: 'number', minimum: 0, maximum: 10 } },
      required: ['n'],
    }
    assertParity(
      schema,
      HOSTILE_NUMBERS.map((n) => ({ n })),
    )
  })

  it('agrees when the numeric keywords sit on array items', () => {
    const schema = { type: 'array', items: { type: 'number', minimum: 0 } }
    assertParity(
      schema,
      HOSTILE_NUMBERS.map((n) => [n]),
    )
  })

  it('agrees on a bare number type, which accepts non-finite values', () => {
    // The complement of the cases above: with no bound and no `multipleOf`,
    // `NaN` and `±Infinity` are accepted by both, as they are by Ajv. A parity
    // test that only ever rejected them would pass vacuously.
    assertParity({ type: 'number' }, HOSTILE_NUMBERS)
  })
})
