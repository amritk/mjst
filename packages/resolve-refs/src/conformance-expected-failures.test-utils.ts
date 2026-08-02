import type { ExpectedFailures } from '../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases where resolution does not preserve
 * the document's meaning, each with the reason.
 *
 * It is empty, and that is the point: the resolver no longer has a case it gets
 * wrong. The last entries here were the `$dynamicRef` ones — a `$dynamicRef`
 * binds at *evaluation* time to the outermost `$dynamicAnchor` along the dynamic
 * scope, so inlining could only ever pick one of the targets it may bind to. The
 * resolver stopped picking: where the binding is not decidable statically it
 * keeps the `$dynamicRef` (and the anchors and `$id` scopes it needs to resolve
 * later) instead of collapsing it, which turns a wrong answer into a preserved
 * question. See `dynamic-scope.ts`.
 *
 * `conformance.test.ts` fails if a case listed here starts passing (the entry
 * must go) or if a case not listed here starts failing (a regression), so the
 * boundary cannot move silently — including from empty.
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one. Look one up in
 * `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {}
