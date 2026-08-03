import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { loadDialectMetaschema } from '../../../../fixtures/json-schema-test-suite/dialect-metaschema'
import {
  compareToExpected,
  conformanceRate,
  loadSuiteCases,
  loadSuiteRemotes,
  type SuiteCase,
} from '../../../../fixtures/json-schema-test-suite/load-suite'
import { buildValidatorSchema } from './build-schema'
import { EXPECTED_FAILURES } from './conformance-expected-failures.test-utils'
import { linkGenerated } from './link-generated.test-utils'

/**
 * Measures the *generated* validators against the official JSON Schema Test
 * Suite — the same corpus `@amritk/runtime-validators` is held to, so the two
 * halves of this monorepo's validation story are read on one scale.
 *
 * Every schema is generated, and the emitted files are compiled and linked in
 * memory, so what is measured is the code users actually ship: the root
 * validator, the `$ref`'d siblings it delegates to, and the shared runtime
 * helpers. A schema the generator refuses to compile counts as a failure too —
 * refusing is safer than emitting a permissive validator, but it is still a case
 * the package cannot serve.
 *
 * The generator is a build-time subset by design (it trades keyword coverage for
 * flat, fast, readable output), so the expected-failure list is long. Its job is
 * to make that subset *exact*: `conformance-expected-failures.test-utils.ts`
 * names every gap, and this suite fails when one closes as well as when one opens.
 */

/**
 * The suite's `remotes/` documents plus the dialect metaschema, handed to the
 * generator through its public `schemas` registry.
 *
 * The suite serves these over HTTP at `http://localhost:1234/`; a generator that
 * does no I/O is given the already-parsed documents instead. That answers the
 * retrieval step and nothing else — the generator still has to apply the base
 * URIs, walk the anchors across documents, name a file for each definition it
 * reaches, and emit an import graph that links. The metaschema is the published
 * `@amritk/runtime-validators/metaschema`, re-exported by the shared fixtures
 * rather than reached for through another package's internals, and covers the
 * cases that validate a schema against its own dialect.
 */
const DOCUMENTS = { ...loadDialectMetaschema(), ...loadSuiteRemotes() }

/**
 * Generates and links the validator for one group's schema. Cases are generated
 * per group rather than per case — a suite group is one schema and many
 * instances — which is a third of the codegen work for the same coverage.
 */
const compile = async (schema: unknown): Promise<((input: unknown) => unknown) | string> => {
  try {
    const files = await buildValidatorSchema(schema as JSONSchema, 'Root', '', DOCUMENTS)
    const validator = linkGenerated<(input: unknown) => unknown>(files, 'index', 'validateRoot')
    return typeof validator === 'function' ? validator : 'generated no validateRoot export'
  } catch (error) {
    return `generation refused: ${(error as Error).message}`
  }
}

/** Runs one case through its group's validator; `null` when it conforms. */
const check = (validator: (input: unknown) => unknown, testCase: SuiteCase): string | null => {
  let accepted: boolean
  try {
    accepted = validator(testCase.data) === true
  } catch (error) {
    return `validator threw: ${(error as Error).message}`
  }
  if (accepted === testCase.valid) return null
  return testCase.valid ? 'rejected an instance the spec requires be accepted' : 'accepted an invalid instance'
}

const CASES = loadSuiteCases()
const RESULTS = new Map<string, string | null>()
const GROUPS = new Map<string, SuiteCase[]>()
for (const testCase of CASES) {
  const group = `${testCase.file}/${testCase.group}`
  GROUPS.set(group, [...(GROUPS.get(group) ?? []), testCase])
}
await Promise.all(
  [...GROUPS.values()].map(async (group) => {
    const compiled = await compile(group[0]?.schema)
    for (const testCase of group) {
      RESULTS.set(testCase.key, typeof compiled === 'string' ? compiled : check(compiled, testCase))
    }
  }),
)

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
    console.log(`JSON Schema draft 2020-12 suite (generate-validators): ${conformanceRate(RESULTS)}`)
    expect([...RESULTS.values()].filter((reason) => reason === null).length).toBeGreaterThan(0)
  })
})
