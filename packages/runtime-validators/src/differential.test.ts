import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { CASES, makeRng, mutate, randomValue } from './differential-corpus.test-utils'
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
 *
 * `contains` next to `unevaluatedItems` is excluded for the same reason: Ajv
 * marks the *whole* array evaluated once `contains` is satisfied, while 2020-12
 * says only the matched items are, and the official test suite agrees with the
 * spec. We follow the spec there, so Ajv is not a usable oracle for that pair —
 * `validate.test.ts` and `conformance.test.ts` cover it instead.
 *
 * `multipleOf` with a repeating-fraction divisor (`0.1`, `0.01`) is also out of
 * scope: we judge multiples by distance to the nearest integer, while Ajv's
 * default check is `value / multipleOf !== parseInt(...)`. The two disagree both
 * ways — Ajv rejects `0.3` against `multipleOf: 0.1` (we accept it) yet wrongly
 * rejects huge integers like `1e21` against `multipleOf: 1` because `parseInt`
 * stringifies them to exponential form. Cases here use only exactly
 * representable divisors so the two implementations line up.
 */

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
