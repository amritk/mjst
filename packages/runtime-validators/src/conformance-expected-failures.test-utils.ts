import type { ExpectedFailures } from '../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases this interpreter does not handle,
 * each with the reason.
 *
 * Unlike `packages/yaml`'s equivalent, this is not a description of a
 * deliberate subset — the package implements Draft 2020-12 — so every entry
 * here is a real gap, and the list is meant to shrink. It exists so the gaps are
 * **known** ones: `conformance.test.ts` fails if a case listed here starts
 * passing (the entry must go) or if a case not listed here starts failing (a
 * regression). The boundary cannot move silently.
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one when a whole group or file falls to a single cause.
 * Look one up in `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * What is left falls into one of two causes, and both are the *same* decision:
 * this package does no I/O.
 *  - **retrieval** — the `$ref` names a document that is not this one, so
 *    answering it means fetching a URL or reading a file. In-document `$id`
 *    resolution is implemented (see `schema-registry.ts`); what is missing here
 *    is only the document itself.
 *  - **vocabulary** — `$vocabulary` in a custom metaschema is not read, because
 *    reading it means fetching that metaschema.
 *
 * Every refusal throws, so a schema in one of these shapes fails loudly at the
 * call site rather than validating against a subset of what its author wrote.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // retrieval: the `$ref` target lives in another document
  //
  // Resolving these means loading a second document — over HTTP, or off disk.
  // That is `@amritk/resolve-refs`' job by design: this package has no fetch, no
  // filesystem, and no cache, which is what lets it run unchanged under a strict
  // CSP and on Cloudflare Workers. Bundle the referenced documents into `$defs`
  // (or resolve them ahead of time) and every one of these shapes validates.
  // ---------------------------------------------------------------------------
  'defs.json': 'retrieval: `$ref` to the 2020-12 metaschema, which is not bundled',

  'dynamicRef.json/strict-tree schema, guards against misspelled properties':
    'retrieval: `$ref` to `tree.json`, another document',
  'dynamicRef.json/tests for implementation dynamic anchor and reference link':
    'retrieval: `$ref` to `extendible-dynamic-ref.json`, another document',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first':
    'retrieval: `$ref` to `extendible-dynamic-ref.json`, another document',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first':
    'retrieval: `$ref` to `extendible-dynamic-ref.json`, another document',
  'dynamicRef.json/$ref to $dynamicRef finds detached $dynamicAnchor':
    'retrieval: `$ref` to `detached-dynamicref.json`, another document',

  'ref.json/remote ref, containing refs itself': 'retrieval: `$ref` to the 2020-12 metaschema, which is not bundled',

  'refRemote.json': 'retrieval: every case here fetches another document, which this package deliberately does not do',

  // ---------------------------------------------------------------------------
  // vocabulary: `$vocabulary` is not read
  //
  // A custom metaschema can switch the validation vocabulary *off*, after which
  // `minimum` and friends are annotations that never fail. Honouring that means
  // fetching the metaschema named by `$schema` and reading its `$vocabulary` —
  // the same I/O the retrieval cases above need. Everything stays enforced
  // instead, which is the stricter of the two answers.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: `$vocabulary` in a fetched metaschema cannot switch validation off',
}
