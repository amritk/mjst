import type { ExpectedFailures } from '../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases where resolution does not preserve
 * the document's meaning, each with the reason.
 *
 * `conformance.test.ts` fails if a case listed here starts passing (the entry
 * must go) or if a case not listed here starts failing (a regression), so the
 * boundary cannot move silently.
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one. Look one up in
 * `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * Empty is the goal, and currently the truth: every reference-carrying case in
 * the suite survives resolution unchanged.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {}
