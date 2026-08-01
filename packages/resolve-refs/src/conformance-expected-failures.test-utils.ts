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
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // `$dynamicRef` through the dynamic scope
  //
  // A `$dynamicRef` does not name one target. It binds at *evaluation* time to
  // the outermost `$dynamicAnchor` of that name along the dynamic scope — the
  // chain of schemas actually being applied — so the same keyword resolves
  // differently depending on where evaluation entered from. Inlining happens
  // once, statically, and can only ever pick a single target, so a resolver that
  // inlines cannot be right about this in general. The README says as much: the
  // full dynamic-scope algorithm is not modelled. What the resolver does instead
  // is bind to the anchor in *lexical* scope, which is the same answer whenever
  // the two coincide and a different one when they do not.
  //
  // Two shapes of `$dynamicRef` are handled and must stay handled, so they are
  // deliberately absent from this list: a pointer-form `$dynamicRef`
  // (`#/$defs/items`), which the spec says behaves exactly like `$ref`, and an
  // anchor name that binds unambiguously across the document.
  //
  // Each entry says which way the mis-binding falls out, because both happen:
  // inlining a *weaker* target than evaluation would have chosen accepts an
  // instance the spec rejects, and inlining a stricter one rejects an instance
  // the spec accepts.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/A $dynamicRef resolves to the first $dynamicAnchor still in scope that is encountered when the schema is evaluated':
    'dynamic scope: binds to the lexically nearest `items` anchor rather than the one still in scope at evaluation, so the resolved document accepts an invalid instance',
  "dynamicRef.json/A $dynamicRef with intermediate scopes that don't include a matching $dynamicAnchor does not affect dynamic scope resolution":
    'dynamic scope: evaluation looks past the intermediate scopes for the anchor and static inlining does not, so the resolved document accepts an invalid instance',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope':
    'dynamic scope: binds to the anchor the ref initially resolves to instead of the outermost one in the dynamic scope, so the resolved document accepts an invalid instance',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword':
    'dynamic scope: one keyword is reached by two evaluation paths that need two different targets, and inlining can only pick one, so the resolved document accepts an invalid instance',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef/string matches /$defs/thingy, but the $dynamicRef does not stop here':
    'dynamic scope: binds to an anchor in a scope evaluation has already left, so the resolved document accepts an invalid instance',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef//then/$defs/thingy is the final stop for the $dynamicRef':
    'dynamic scope: the same mis-binding the other way round — the inlined target is stricter than the one evaluation reaches, so the resolved document rejects a valid instance',
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered':
    'dynamic scope: a resource root registers a scope without being the binding target, a distinction static inlining cannot draw, so the resolved document accepts an invalid instance',
  'unevaluatedItems.json/unevaluatedItems with $dynamicRef':
    'dynamic scope: `unevaluatedItems` depends on what the dynamically-bound branch evaluated, and the inlined branch is not that one, so the resolved document rejects a valid instance',
  'unevaluatedProperties.json/unevaluatedProperties with $dynamicRef':
    'dynamic scope: `unevaluatedProperties` depends on what the dynamically-bound branch evaluated, and the inlined branch is not that one, so the resolved document rejects a valid instance',
}
