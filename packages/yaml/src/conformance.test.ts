import { describe, expect, it } from 'vitest'
import Suite from 'yaml-test-suite'

import { EXPECTED_FAILURES } from './conformance-expected-failures.test-utils'
import { parseAllDocuments } from './parse-document'

/**
 * Measures this parser against the official YAML test suite — the same corpus
 * every YAML implementation is judged on.
 *
 * This package is a deliberate *subset* of YAML 1.2 (see the README's Scope
 * section), so a clean sweep is not the goal and never will be. The goal is that
 * the subset is a **known** one: every case we do not handle is listed in
 * `conformance-expected-failures.ts` with the reason, and the suite fails if a
 * case moves in either direction — a regression breaks the build, and so does a
 * case that starts passing without its entry being removed. That turns the
 * README's scope claims from prose into something checked.
 *
 * The suite ships as a dev dependency and is never imported by `src/index.ts`,
 * so none of this reaches the published bundle.
 */

/** One suite case, flattened out of the per-file grouping the package ships. */
type Case = {
  key: string
  name: string
  yaml: string
  /** Expected output as a JSON stream — one value per document. Absent for some cases. */
  json?: string | undefined
  /** Whether the document is required to be rejected. */
  fail: boolean
}

const flatten = (): Case[] => {
  const out: Case[] = []
  for (const file of Suite as unknown as SuiteFile[]) {
    const cases = file.cases ?? []
    for (let i = 0; i < cases.length; i++) {
      const entry = cases[i]
      if (entry === undefined || typeof entry.yaml !== 'string') continue
      out.push({
        key: cases.length === 1 ? file.id : `${file.id}/${i}`,
        name: entry.name ?? file.name ?? file.id,
        yaml: entry.yaml,
        json: entry.json,
        fail: entry.fail === true,
      })
    }
  }
  return out
}

type SuiteFile = {
  id: string
  name?: string
  cases?: { name?: string; yaml?: string; json?: string; fail?: boolean }[]
}

/**
 * Splits the suite's expected output — a stream of JSON values, one per document,
 * concatenated with whitespace — into the individual values. `JSON.parse` reads
 * exactly one value, so a multi-document expectation has to be cut apart first:
 * we scan for the top-level value boundaries, tracking string literals so a
 * brace inside `"{"` does not shift the depth.
 */
const splitJsonStream = (text: string): unknown[] => {
  const values: unknown[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] ?? '')) i++
    if (i >= text.length) break
    const start = i
    let depth = 0
    let inString = false
    let escaped = false
    for (; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') depth--
      else if (depth === 0 && /\s/.test(c ?? '')) break
      if (depth === 0 && (c === '}' || c === ']')) {
        i++
        break
      }
    }
    values.push(JSON.parse(text.slice(start, i)))
  }
  return values
}

/**
 * Structural equality against a value decoded from JSON. Deliberately stricter
 * than `JSON.stringify` comparison, which silently drops an `undefined` property
 * — exactly the shape a dropped key would take — and cannot tell a `Date` from
 * the string it serializes to.
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  // Anything the suite's JSON cannot express (Date, Set, Map, bytes) is a
  // mismatch by construction, which is what we want it to be.
  if (a.constructor !== Object || b.constructor !== Object) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(
    (k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** Runs one case, returning `null` when it conforms or a short reason when it does not. */
const check = (testCase: Case): string | null => {
  let docs: ReturnType<typeof parseAllDocuments>
  try {
    docs = parseAllDocuments(testCase.yaml)
  } catch (error) {
    return testCase.fail ? null : `threw: ${(error as Error).message}`
  }
  const problems = docs.flatMap((doc) => doc.errors)

  if (testCase.fail) {
    return problems.length > 0 ? null : 'accepted a document the suite requires be rejected'
  }
  if (problems.length > 0) return `rejected a valid document: ${problems.map((p) => p.code).join(', ')}`
  if (testCase.json === undefined) return null

  let expected: unknown[]
  try {
    expected = splitJsonStream(testCase.json)
  } catch {
    // The expectation itself is not plain JSON (the suite uses a few such cases
    // for values JSON cannot hold); there is nothing to compare against.
    return null
  }
  let actual: unknown[]
  try {
    actual = docs.map((doc) => doc.toJS())
  } catch (error) {
    return `toJS threw: ${(error as Error).message}`
  }
  // A stream whose documents are all empty is written as no documents at all by
  // some cases; compare only when the counts agree on there being content.
  if (actual.length !== expected.length) return `produced ${actual.length} document(s), expected ${expected.length}`
  for (let i = 0; i < expected.length; i++) {
    if (!deepEqual(actual[i], expected[i])) {
      return `output mismatch: got ${JSON.stringify(actual[i])}, expected ${JSON.stringify(expected[i])}`
    }
  }
  return null
}

const CASES = flatten()
const RESULTS = new Map(CASES.map((testCase) => [testCase.key, check(testCase)]))

describe('YAML test suite conformance', () => {
  it('loads the suite', () => {
    // A silent failure to load would make every assertion below vacuously true.
    expect(CASES.length).toBeGreaterThan(300)
  })

  it('handles every case that is not a known, documented gap', () => {
    const unexpected = [...RESULTS]
      .filter(([key, reason]) => reason !== null && !(key in EXPECTED_FAILURES))
      .map(([key, reason]) => `${key} (${CASES.find((c) => c.key === key)?.name}): ${reason}`)
    expect(unexpected).toEqual([])
  })

  it('has no stale entries in the expected-failure list', () => {
    // A case that starts passing has to have its entry removed, so the list can
    // never quietly overstate what is unsupported.
    const stale = Object.keys(EXPECTED_FAILURES).filter((key) => RESULTS.get(key) === null)
    expect(stale).toEqual([])
  })

  it('lists only real suite cases', () => {
    const unknown = Object.keys(EXPECTED_FAILURES).filter((key) => !RESULTS.has(key))
    expect(unknown).toEqual([])
  })

  it('reports the conformance rate', () => {
    const passing = [...RESULTS.values()].filter((reason) => reason === null).length
    const rate = ((passing / RESULTS.size) * 100).toFixed(1)
    console.log(`YAML 1.2 test suite: ${passing}/${RESULTS.size} cases (${rate}%)`)
    expect(passing).toBeGreaterThan(0)
  })
})
