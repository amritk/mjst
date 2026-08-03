import type { ExpectedFailures } from '../../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases the *generated* validators do not
 * handle, each with the reason.
 *
 * The generator is a build-time subset by design — it trades keyword coverage for
 * flat, readable, dependency-free output — but the subset is no longer where the
 * gap is: 13 of 1281 cases are left. What used to dominate this list was the
 * cross-document `$ref`, and that is gone: documents handed to the generator
 * through its `schemas` registry are folded into the one being generated, so a
 * ref into `integer.json`, `tree.json` or the 2020-12 metaschema resolves, gets a
 * file, and is enforced like anything else. Nothing is fetched — the caller does
 * the loading — but "we do no I/O" no longer means "we cannot be told".
 *
 * What is left is `$dynamicRef` resolved through the dynamic scope (which a
 * generator that emits one function per definition cannot follow), one filename
 * collision, one `$id`-scoping residue, and a short tail of arithmetic/regex
 * judgement calls.
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one when a whole group or file falls to a single cause.
 * Look one up in `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * `conformance.test.ts` fails if a case listed here starts passing (the entry
 * must go) or if a case not listed here starts failing (a regression), so this
 * list is exact rather than approximate.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // `$dynamicRef`: late binding through the dynamic scope
  //
  // A `$dynamicRef` picks its target from the `$dynamicAnchor`s that happen to be
  // in scope at *validation* time, which can differ per call site. Generation
  // resolves it once, statically, to the anchor it can see — so a schema that
  // re-binds the same anchor from two different scopes gets one answer where the
  // spec asks for two. Unlike the refs above this does not refuse: a single
  // binding is a real, useful reading of the schema, it is just not the dynamic
  // one. `@amritk/runtime-validators` carries the scope through its walk and does
  // handle these.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope/The recursive part is not valid against the root':
    '`$dynamicRef`: the recursive position re-binds "#meta" from an outer scope, which a statically resolved ref cannot follow',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword/number list with string values':
    '`$dynamicRef`: the anchor binds differently down each path, and generation picks one of them',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword/string list with number values':
    '`$dynamicRef`: the anchor binds differently down each path, and generation picks one of them',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef/first_scope is not in dynamic scope for the $dynamicRef':
    '`$dynamicRef`: the anchor that is no longer in scope is still the one generation resolved to',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef//then/$defs/thingy is the final stop for the $dynamicRef':
    '`$dynamicRef`: the anchor that is no longer in scope is still the one generation resolved to',

  // ---------------------------------------------------------------------------
  // one file per definition: two definitions, one filename
  //
  // Every `$ref` target becomes its own generated file, named after the last
  // segment of the ref. Two definitions called `stuff` in different parents want
  // the same `stuff.ts`, and emitting one of them would make every reference to
  // the other resolve to the wrong schema — so generation stops instead. This is
  // a property of the file layout, not of the schema language.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered':
    'one file per definition: "#/$defs/first/$defs/stuff" and "#/$defs/second/$defs/stuff" both want the file "stuff.ts"',

  // ---------------------------------------------------------------------------
  // vocabulary: `$vocabulary` in a custom metaschema
  //
  // A custom metaschema can switch the validation vocabulary off, after which
  // `minimum` and friends never fail. The metaschema that says so is reachable —
  // register it and it generates like any other document — but `$vocabulary` is
  // read as a *declaration about the generator*, not as a schema to enforce, and
  // nothing here acts on it. Everything stays enforced instead, which is the
  // stricter reading.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: a registered metaschema is generated, but `$vocabulary` does not switch validation off',

  // ---------------------------------------------------------------------------
  // `$id` scope on an in-document pointer
  //
  // A nested `$id` re-bases the `#/$defs/...` pointers written inside it, so the
  // same pointer text names a different definition depending on which resource it
  // sits in. The generator resolves the pointer against the document, which is
  // right for the outer field and wrong for the inner one — the only place in the
  // suite where that distinction changes a verdict.
  // ---------------------------------------------------------------------------
  'ref.json/refs with relative uris and defs/invalid on inner field':
    '`$id` scope: the inner `#/$defs/...` pointer is re-based by a nested `$id`, so it resolves to the outer definition',
  'ref.json/relative refs with absolute uris and defs/invalid on inner field':
    '`$id` scope: the inner `#/$defs/...` pointer is re-based by a nested `$id`, so it resolves to the outer definition',

  // ---------------------------------------------------------------------------
  // arithmetic and regex flags
  //
  // Judgement calls rather than missing features. `multipleOf` compares the
  // quotient to its nearest integer within a scaled tolerance (the shared
  // `@amritk/helpers/multiple-of-check`, chosen so `0.3` satisfies
  // `multipleOf: 0.1`); a quotient that overflows to `Infinity` makes that
  // comparison `NaN`, which the check reads as passing. And `pattern` compiles
  // without the `u` flag, so ECMAScript Unicode property escapes are inert.
  // ---------------------------------------------------------------------------
  'multipleOf.json/float division = inf':
    'arithmetic: an overflowing quotient makes the tolerance comparison `NaN`, and `NaN > tolerance` is false, so the value reads as a clean multiple',
  'pattern.json/pattern with Unicode property escape requires unicode mode/ASCII letters match':
    'regex: `pattern` compiles without the `u` flag, so a Unicode property escape never matches',
  'pattern.json/pattern with Unicode property escape requires unicode mode/Non-ASCII letters match':
    'regex: `pattern` compiles without the `u` flag, so a Unicode property escape never matches',
}
