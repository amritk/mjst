import { isDeepStrictEqual } from 'node:util'
import { metaschema } from '@amritk/runtime-validators/metaschema'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import {
  compareToExpected,
  conformanceRate,
  loadSuiteCases,
  loadSuiteRemotes,
  type SuiteCase,
} from '../../../../fixtures/json-schema-test-suite/load-suite'
import { buildSchema } from './build-schema'
import { linkGenerated } from './differential.test-utils'
import { EXPECTED_FAILURES } from './json-schema-conformance-expected-failures.test-utils'

/**
 * Measures the *strict* generated parsers against the official JSON Schema Test
 * Suite — the same corpus `@amritk/runtime-validators` and
 * `@amritk/generate-validators` are held to.
 *
 * Strict mode is the mode with a verdict: it throws on anything the schema does
 * not admit, so "parses without throwing" and "the spec says valid" are directly
 * comparable. (The default coercing mode has no such contract — its job is to
 * make input fit the type, which is a different question and one the differential
 * fuzz suites already cover against Ajv.)
 *
 * Two things are asserted per case, because a parser can fail either way: the
 * accept/reject verdict, and — for an accepted instance — that the value came
 * back unchanged. Strict mode does not coerce, so a parser that quietly rewrites
 * a valid document is as wrong as one that rejects it.
 *
 * Schemas are generated whole (`buildSchema`, embedded helpers) and linked in
 * memory, so `$ref`'d siblings and the runtime helpers are exercised, not just
 * the root file. A schema strict mode *refuses* — its answer to a keyword it
 * cannot enforce — counts as a failure here: it is a case the package cannot
 * serve, even though refusing is the right thing to do with it.
 */

/**
 * The suite's `remotes/` documents plus the dialect metaschema, handed to the
 * generator through its public `schemas` registry.
 *
 * The suite serves these over HTTP at `http://localhost:1234/`; a generator that
 * does no I/O is given the already-parsed documents instead. Only the retrieval
 * step is answered — the generator still has to apply the base URIs, walk the
 * anchors across documents, name and emit a parser for every definition it
 * reaches, and produce an import graph that links and type-checks. The
 * metaschema comes from `@amritk/runtime-validators/metaschema`, a published
 * export rather than another package's internals, and covers the cases that
 * parse a schema against its own dialect.
 */
const DOCUMENTS = { ...metaschema, ...loadSuiteRemotes() }

/** Builds and links the strict parser for one group's schema. */
const compile = async (schema: unknown): Promise<((input: unknown) => unknown) | string> => {
  try {
    const files = await buildSchema(
      schema as JSONSchema,
      'Root',
      undefined,
      false,
      false,
      true,
      'embedded',
      './',
      false,
      false,
      '',
      'js',
      false,
      DOCUMENTS,
    )
    const parse = linkGenerated<(input: unknown) => unknown>(files, 'index', 'parseRoot')
    return typeof parse === 'function' ? parse : 'generated no parseRoot export'
  } catch (error) {
    return `generation refused: ${(error as Error).message}`
  }
}

/** Runs one case through its group's parser; `null` when it conforms. */
const check = (parse: (input: unknown) => unknown, testCase: SuiteCase): string | null => {
  const input = structuredClone(testCase.data)
  let parsed: unknown
  try {
    parsed = parse(input)
  } catch {
    return testCase.valid ? 'rejected an instance the spec requires be accepted' : null
  }
  if (!testCase.valid) return 'accepted an invalid instance'
  if (!isDeepStrictEqual(parsed, testCase.data)) {
    return `changed a valid instance: got ${JSON.stringify(parsed)}`
  }
  return null
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
    console.log(`JSON Schema draft 2020-12 suite (generate-parsers, strict): ${conformanceRate(RESULTS)}`)
    expect([...RESULTS.values()].filter((reason) => reason === null).length).toBeGreaterThan(0)
  })
})
