import { describe, expect, it } from 'vitest'
import { validate } from '@/validate'
import { validateGuard } from '@/validate-guard'

import {
  compareToExpected,
  conformanceRate,
  loadSuiteFormatCases,
  type SuiteCase,
} from '../../../../fixtures/json-schema-test-suite/load-suite'
import { EXPECTED_FORMAT_FAILURES } from './format-conformance-expected-failures.test-utils'

/**
 * Measures the `format` checks against the official suite's **optional** format
 * corpus — 861 cases that ask not whether a format is recognized but whether it
 * is decided correctly.
 *
 * The suite files these as optional because an implementation may treat every
 * `format` as an annotation and still conform. This one opts in
 * (`{ formats: 'all' }`), so it is held to them: a format that is checked and
 * checked wrongly is worse than one left as an annotation, because a caller who
 * asked for validation believes the answer.
 *
 * Where the suite and Ajv disagree, the suite wins — it is the specification's
 * own corpus, and Ajv is one implementation of it. `format-checks.test.ts`
 * records the places that costs us agreement with Ajv.
 *
 * Both entry points run, for the same reason `conformance.test.ts` runs both:
 * they share the interpreter but not the path through it.
 */

/** Runs one case, returning `null` when it conforms or a short reason when it does not. */
const check = (testCase: SuiteCase): string | null => {
  let result: unknown
  let guarded: boolean
  try {
    result = validate(testCase.schema, { formats: 'all' })(testCase.data)
    guarded = validateGuard(testCase.schema, { formats: 'all' })(testCase.data)
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

const CASES = loadSuiteFormatCases()
const RESULTS = new Map(CASES.map((testCase) => [testCase.key, check(testCase)]))

describe('format conformance', () => {
  it('loads the format suite', () => {
    // A silent failure to load would make every assertion below vacuously true.
    expect(CASES.length).toBeGreaterThan(800)
  })

  it('decides every format case that is not a known, documented gap', () => {
    const { unexpected } = compareToExpected(RESULTS, EXPECTED_FORMAT_FAILURES)
    expect(unexpected).toEqual([])
  })

  it('has no stale entries in the expected-failure list', () => {
    // A case that starts passing has to have its entry removed, so the list can
    // never quietly overstate what is unsupported.
    const { stale } = compareToExpected(RESULTS, EXPECTED_FORMAT_FAILURES)
    expect(stale).toEqual([])
  })

  it('reports the conformance rate', () => {
    console.log(`JSON Schema draft 2020-12 optional/format suite: ${conformanceRate(RESULTS)}`)
    expect([...RESULTS.values()].filter((reason) => reason === null).length).toBeGreaterThan(0)
  })
})
