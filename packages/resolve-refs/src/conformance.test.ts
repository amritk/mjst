import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import {
  compareToExpected,
  conformanceRate,
  loadSuiteCases,
  type SuiteCase,
} from '../../../fixtures/json-schema-test-suite/load-suite'
import { EXPECTED_FAILURES } from './conformance-expected-failures.test-utils'
import { resolveRefs } from './resolve-refs'

/**
 * Measures the resolver against the `$ref` corpus of the official JSON Schema
 * Test Suite — `ref.json`, `dynamicRef.json`, `anchor.json`, `defs.json` and
 * every other case whose schema carries a reference.
 *
 * The resolver produces no verdicts of its own, so conformance here is
 * *semantic preservation*: inlining a document must not change what it accepts.
 * Each case is validated twice with `@amritk/runtime-validators` — once through
 * the original schema, once through the resolved one — and the two must agree
 * with the spec.
 *
 * Cases the interpreter itself gets wrong are excluded, and so are schemas with
 * no reference at all: the first would measure the interpreter (its own
 * conformance suite does that), and the second would measure nothing. What is
 * left is exactly the population where a resolution bug is visible — a ref
 * inlined from the wrong place, a sibling keyword dropped, a cycle collapsed.
 */

/** Whether a schema contains a reference anywhere — the population this suite is about. */
const hasRef = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasRef)
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record['$ref'] === 'string' || typeof record['$dynamicRef'] === 'string') return true
  return Object.values(record).some(hasRef)
}

/** The interpreter's verdict, or `null` when it cannot reach one. */
const verdict = (schema: unknown, data: unknown): boolean | null => {
  try {
    return validate(schema)(data) === true
  } catch {
    return null
  }
}

/** Runs one case; `null` when resolution preserved the spec verdict. */
const check = (testCase: SuiteCase): string | null => {
  let result: ReturnType<typeof resolveRefs>
  try {
    result = resolveRefs(testCase.schema)
  } catch (error) {
    return `threw: ${(error as Error).message}`
  }
  if (result.errors.length > 0) {
    return `reported ${result.errors.length} error(s): ${result.errors.map((error) => error.message).join('; ')}`
  }
  const after = verdict(result.resolved, testCase.data)
  if (after === null) return 'the resolved document no longer validates: the interpreter cannot reach a verdict'
  if (after !== testCase.valid) {
    return after
      ? 'the resolved document accepts an invalid instance'
      : 'the resolved document rejects a valid instance'
  }
  return null
}

/**
 * The corpus: reference-carrying cases the interpreter already answers correctly
 * *before* resolution, so any disagreement afterwards is the resolver's.
 */
const CASES = loadSuiteCases().filter(
  (testCase) => hasRef(testCase.schema) && verdict(testCase.schema, testCase.data) === testCase.valid,
)
const RESULTS = new Map(CASES.map((testCase) => [testCase.key, check(testCase)]))

describe('JSON Schema Test Suite conformance', () => {
  it('loads a non-trivial corpus of reference-carrying cases', () => {
    // A filter that silently matched nothing would make every assertion below
    // vacuously true.
    expect(CASES.length).toBeGreaterThan(100)
  })

  it('preserves the verdict for every case that is not a known, documented gap', () => {
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
    console.log(`JSON Schema draft 2020-12 suite (resolve-refs, $ref corpus): ${conformanceRate(RESULTS)}`)
    expect([...RESULTS.values()].filter((reason) => reason === null).length).toBeGreaterThan(0)
  })
})
