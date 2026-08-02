import type { ExpectedFailures } from '../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases this interpreter does not handle,
 * each with the reason.
 *
 * It is empty, and keeping it around empty is the point: `conformance.test.ts`
 * fails if a case listed here starts passing (the entry must go) or if a case
 * not listed here starts failing (a regression). An empty table means the whole
 * suite passes, and the moment one case stops, the build names it rather than
 * letting a percentage quietly tick down.
 *
 * Keys, when there are any, are case ids — `<file>/<group description>/<test
 * description>` — or a `/`-bounded prefix of one when a whole group or file
 * falls to a single cause. Look one up in
 * `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * ---------------------------------------------------------------------------
 * what used to be here, and what closed it
 * ---------------------------------------------------------------------------
 * Every entry this list ever held came down to one thing: the `$ref` named a
 * document that was not the one being validated, so answering it meant fetching
 * a URL or reading a file. That is still not something this package does — no
 * `fetch`, no filesystem, no cache — which is what lets it run unchanged under a
 * strict CSP and on Cloudflare Workers.
 *
 * What changed is that "we do not fetch" stopped meaning "we cannot be told".
 * `ValidateOptions.schemas` takes documents the caller has already loaded, keyed
 * by absolute URI, and makes them resolvable targets for `$ref` and
 * `$dynamicRef`. The harness hands the suite's own `remotes/` documents to it —
 * the registry standing in for the HTTP server the suite would otherwise expect
 * — and the retrieval cases resolve like any other: `refRemote.json`, the
 * `dynamicRef.json` groups reaching for `tree.json`, `extendible-dynamic-ref.json`
 * and `detached-dynamicref.json`, and `defs.json`'s and `ref.json`'s refs to the
 * dialect metaschema.
 *
 * `vocabulary.json`'s "no validation" case closed one step further on: with the
 * metaschema registered, its `$vocabulary` can finally be *read*, so a dialect
 * that omits the validation vocabulary turns those keywords into annotations
 * instead of assertions (see `asserts-validation.ts`).
 */
export const EXPECTED_FAILURES: ExpectedFailures = {}
