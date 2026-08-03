import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The suite's `remotes/` documents, keyed by the URIs its HTTP server would
 * serve them from — the map every package here takes as its "documents I have
 * already loaded" registry.
 *
 * The suite's own protocol is to serve these from `http://localhost:1234/`, so
 * `remotes/draft2020-12/integer.json` is
 * `http://localhost:1234/draft2020-12/integer.json`. Every implementation in
 * every language runs `refRemote.json` by making those URIs resolvable one way
 * or another; a harness with an HTTP server does it with a socket, and we do it
 * by handing the already-parsed documents to the public API. Nothing about the
 * measurement changes — the package under test still has to resolve the base
 * URIs, walk the anchors, and get `$dynamicRef` bookending right across
 * documents — only the retrieval step is answered for it, which is the one thing
 * none of these packages will ever do themselves.
 *
 * The dialect metaschema is deliberately *not* included: it is not part of
 * `remotes/`, and each package supplies its own copy (or declines to) rather
 * than reaching into another package's internals.
 *
 * @param draft - Which vendored draft's remotes to load. Defaults to `draft2020-12`.
 */
export const loadSuiteRemotes = (draft = 'draft2020-12'): Record<string, unknown> => {
  const documents: Record<string, unknown> = {}
  collectRemotes(join(SUITE_DIR, 'remotes', draft), `http://localhost:1234/${draft}`, documents)
  return documents
}

/**
 * Reads every `.json` under `dir` into `documents`, keyed by the URI the suite
 * would have served it from. Subdirectories keep their path segment, because
 * that is exactly what the `retrieved nested refs resolve relative to their URI
 * not $id` case is testing.
 */
const collectRemotes = (dir: string, prefix: string, documents: Record<string, unknown>): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectRemotes(full, `${prefix}/${entry.name}`, documents)
    else if (entry.name.endsWith('.json')) documents[`${prefix}/${entry.name}`] = JSON.parse(readFileSync(full, 'utf8'))
  }
}

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
