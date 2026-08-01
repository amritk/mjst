import { describe, expect, it } from 'vitest'

import {
  compareToExpected,
  conformanceRate,
  loadSuiteCases,
  type SuiteCase,
} from '../../../fixtures/json-schema-test-suite/load-suite'
import { EXPECTED_FAILURES } from './conformance-expected-failures.test-utils'
import { validate } from './validate'
import { validateGuard } from './validate-guard'

/**
 * Measures the interpreter against the official JSON Schema Test Suite — the
 * same corpus every validator in every language is judged on.
 *
 * The bar here is higher than `packages/yaml`'s equivalent: this package claims
 * to implement Draft 2020-12, not a subset of it, so every case the suite
 * requires should pass and each one that does not is listed in
 * `conformance-expected-failures.test-utils.ts` with the reason. The suite fails
 * if a case moves in either direction — a regression breaks the build, and so
 * does a case that starts passing while its entry stays behind.
 *
 * Both entry points run: `validate` (error-collecting) and `validateGuard` (the
 * short-circuiting boolean path). They share the interpreter but not the code
 * path through it, and a divergence between them is a bug on its own — so a
 * case only counts as handled when both agree with the spec.
 */

/** Runs one case, returning `null` when it conforms or a short reason when it does not. */
const check = (testCase: SuiteCase): string | null => {
  let result: unknown
  let guarded: boolean
  try {
    result = validate(testCase.schema)(testCase.data)
    guarded = validateGuard(testCase.schema)(testCase.data)
  } catch (error) {
    return `threw: ${(error as Error).message}`
  }
  const accepted = result === true
  if (accepted !== guarded) {
    return `validate and validateGuard disagree: validate=${accepted}, validateGuard=${guarded}`
  }
  if (accepted === testCase.valid) return null
  return testCase.valid ? 'rejected an instance the spec requires be accepted' : 'accepted an invalid instance'
}

const CASES = loadSuiteCases()
const RESULTS = new Map(CASES.map((testCase) => [testCase.key, check(testCase)]))

describe('JSON Schema Test Suite conformance', () => {
  it('loads the suite', () => {
    // A silent failure to load would make every assertion below vacuously true.
    expect(CASES.length).toBeGreaterThan(1000)
  })

  it('handles every case that is not a known, documented gap', () => {
    const { unexpected } = compareToExpected(RESULTS, EXPECTED_FAILURES)
    expect(unexpected).toEqual([])
  })

  it('has no stale entries in the expected-failure list', () => {
    // A case that starts passing has to have its entry removed, so the list can
    // never quietly overstate what is unsupported.
    const { stale } = compareToExpected(RESULTS, EXPECTED_FAILURES)
    expect(stale).toEqual([])
  })

  it('reports the conformance rate', () => {
    console.log(`JSON Schema draft 2020-12 suite (runtime-validators): ${conformanceRate(RESULTS)}`)
    expect([...RESULTS.values()].filter((reason) => reason === null).length).toBeGreaterThan(0)
  })
})
