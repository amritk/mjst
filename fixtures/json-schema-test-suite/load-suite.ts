import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Root directory holding the vendored suite files. */
const SUITE_DIR = new URL('.', import.meta.url).pathname

/** One instance/verdict pair from the suite, flattened out of its file grouping. */
export type SuiteCase = {
  /** Stable identifier: `<file>/<group description>/<test description>`. */
  key: string
  /** The file the case came from, e.g. `type.json`. */
  file: string
  /** The group's `description` — the schema under test, in words. */
  group: string
  /** The individual test's `description`. */
  description: string
  /** The schema the whole group shares. */
  schema: unknown
  /** The instance to validate. */
  data: unknown
  /** Whether the instance is required to validate. */
  valid: boolean
}

type SuiteGroup = {
  description: string
  schema: unknown
  tests: { description: string; data: unknown; valid: boolean }[]
}

/**
 * Loads every case in the vendored draft 2020-12 suite, flattened so each entry
 * is one schema + one instance + the verdict the spec requires.
 *
 * See `README.md` for what is vendored and why. Files are read from disk on each
 * call rather than imported, so a refreshed fixture needs no code change.
 */
export const loadSuiteCases = (draft = 'draft2020-12'): SuiteCase[] => {
  const dir = join(SUITE_DIR, draft)
  const cases: SuiteCase[] = []
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue
    const groups = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SuiteGroup[]
    for (const group of groups) {
      for (const test of group.tests) {
        cases.push({
          key: `${file}/${group.description}/${test.description}`,
          file,
          group: group.description,
          description: test.description,
          schema: group.schema,
          data: test.data,
          valid: test.valid,
        })
      }
    }
  }
  return cases
}

/**
 * An expected-failure table: each key names a case (or a prefix of one — a whole
 * file, or a whole group within it) that a package is known not to handle, and
 * each value says why.
 *
 * Prefixes exist because the gaps cluster: "remote `$ref`s are not this
 * package's job" is one decision covering forty cases, and forty identical
 * entries would obscure that. A prefix must still earn its place — the suites
 * fail on one that no longer matches any failing case.
 */
export type ExpectedFailures = Record<string, string>

/** Whether `key` is covered by a table entry — the key itself, or a `/`-bounded prefix of it. */
export const isExpectedFailure = (key: string, table: ExpectedFailures): boolean =>
  Object.keys(table).some((entry) => key === entry || key.startsWith(`${entry}/`))

/**
 * Compares a run's outcomes against the table it is held to, returning the two
 * lists that make a conformance suite meaningful in both directions: cases that
 * failed without being listed (a regression), and entries that no longer cover
 * any failure (a stale claim about the boundary).
 *
 * `results` maps a case key to `null` when the package handled it, or a short
 * reason when it did not.
 */
export const compareToExpected = (
  results: ReadonlyMap<string, string | null>,
  table: ExpectedFailures,
): { unexpected: string[]; stale: string[] } => {
  const unexpected: string[] = []
  for (const [key, reason] of results) {
    if (reason !== null && !isExpectedFailure(key, table)) unexpected.push(`${key} — ${reason}`)
  }
  const stale = Object.keys(table).filter(
    (entry) => ![...results].some(([key, reason]) => reason !== null && (key === entry || key.startsWith(`${entry}/`))),
  )
  return { unexpected, stale }
}

/** Formats the pass rate for the console line every conformance suite prints. */
export const conformanceRate = (results: ReadonlyMap<string, string | null>): string => {
  const passing = [...results.values()].filter((reason) => reason === null).length
  return `${passing}/${results.size} cases (${((passing / results.size) * 100).toFixed(1)}%)`
}
