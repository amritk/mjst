import { describe, expect, it } from 'vitest'
import { validateGuard } from '@/validate-guard'

import { loadSuiteCases } from '../../../../fixtures/json-schema-test-suite/load-suite'
import { compileGuard } from './compile-guard'
import { UNCOMPILED_KEYWORDS } from './plan'

/**
 * Holds the compiled guard and the interpreter to the *same verdict* across the
 * official JSON Schema Test Suite.
 *
 * This is the test that makes `compileGuard` safe to offer at all. It is a
 * second way of answering a question this package already answers, and the only
 * defensible basis for shipping one is that it never answers differently — so
 * the interpreter is the oracle, not the spec. A case both refuse is agreement
 * as much as a case both accept: the contract under test is parity, and a
 * documented conformance gap is inherited by the compiler for free.
 *
 * The suite's `remotes/` documents are deliberately **not** registered here.
 * `compileGuard` declines to compile a schema validated against a registry (as
 * it declines a document declaring `$id`), so registering them would send every
 * case down the fallback and this whole file would pass vacuously. Without them
 * the cross-document cases fail in both implementations, which is still parity,
 * while the several thousand ordinary cases exercise the compiled path for real.
 */

/** A case's verdict, with "refused" as a third outcome so a throw is compared too. */
type Verdict = boolean | 'threw'

const verdictOf = (run: () => boolean): Verdict => {
  try {
    return run()
  } catch {
    return 'threw'
  }
}

const CASES = loadSuiteCases()

/**
 * Whether a schema is compiled end-to-end rather than handed to the interpreter
 * somewhere inside. Used only to prove this file is not vacuous — the parity
 * assertion itself covers every case either way.
 */
const fullyCompiled = (schema: unknown, depth = 0): boolean => {
  if (depth > 64) return false
  if (schema === null || typeof schema !== 'object') return true
  if (Array.isArray(schema)) return schema.every((item) => fullyCompiled(item, depth + 1))
  const node = schema as Record<string, unknown>
  if (UNCOMPILED_KEYWORDS.some((keyword) => Object.hasOwn(node, keyword))) return false
  // The document-wide gate: either keyword anywhere stops the whole compile.
  if (Object.hasOwn(node, '$dynamicRef') || Object.hasOwn(node, '$recursiveRef')) return false
  return Object.keys(node).every((key) => fullyCompiled(node[key], depth + 1))
}

describe('compile-parity', () => {
  it('loads the suite', () => {
    // A silent failure to load would make every assertion below vacuously true.
    expect(CASES.length).toBeGreaterThan(1000)
  })

  it("returns the interpreter's verdict for every case in the suite", () => {
    const divergences: string[] = []
    for (const testCase of CASES) {
      const interpreted = verdictOf(() => validateGuard(testCase.schema)(testCase.data))
      const compiled = verdictOf(() => compileGuard(testCase.schema)(testCase.data))
      if (interpreted !== compiled) {
        divergences.push(`${testCase.key}: interpreter=${String(interpreted)} compiled=${String(compiled)}`)
      }
    }
    expect(divergences.slice(0, 20), `${divergences.length} divergence(s)`).toEqual([])
  })

  it('really compiles a large share of the suite rather than falling back throughout', () => {
    // The guard against a green run that only ever exercised the interpreter.
    //
    // The share is a lower bound twice over, and deliberately so. `fullyCompiled`
    // descends into every value including `$defs` and the data keywords, so a
    // schema is disqualified by an `$id` or a `format` sitting anywhere in it —
    // even inside a `const`, where the real compiler would never look. And the
    // suite is by its nature dense in exactly the exotic keywords the fallback
    // covers, which a hot request path is not. Several hundred cases proven to
    // take the compiled path is what this assertion is for.
    const compiled = CASES.filter((testCase) => fullyCompiled(testCase.schema))
    console.log(`compiled end-to-end: ${compiled.length} of ${CASES.length} suite cases`)
    expect(compiled.length).toBeGreaterThan(500)
  })

  it('agrees with the interpreter on the schemas it compiles end-to-end', () => {
    // The same assertion as above, narrowed to the cases that provably took the
    // compiled path — so a regression there cannot hide behind the fallback.
    const divergences: string[] = []
    for (const testCase of CASES.filter((one) => fullyCompiled(one.schema))) {
      const interpreted = verdictOf(() => validateGuard(testCase.schema)(testCase.data))
      const compiled = verdictOf(() => compileGuard(testCase.schema)(testCase.data))
      if (interpreted !== compiled) {
        divergences.push(`${testCase.key}: interpreter=${String(interpreted)} compiled=${String(compiled)}`)
      }
    }
    expect(divergences.slice(0, 20), `${divergences.length} divergence(s)`).toEqual([])
  })
})
