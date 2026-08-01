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
 * Every entry falls into one of three causes:
 *  - **base URI** — a `$ref` the interpreter cannot resolve because resolving it
 *    means applying `$id` as a base URI (or fetching another document). It
 *    throws rather than guessing, so this never silently mis-validates.
 *  - **annotation** — `contains` does not publish which items it matched, so
 *    `unevaluatedItems` cannot see them.
 *  - **vocabulary** — `$vocabulary` in a custom metaschema is not read, so
 *    validation keywords cannot be switched off by one.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // base URI: `$ref` resolution is document-local
  //
  // `resolve-local-ref.ts` resolves JSON-Pointer fragments (`#/$defs/foo`) and
  // `$anchor` names within the document it was handed. It does not maintain a
  // base-URI stack, so a `$ref` written against an `$id` — a relative URI
  // (`list`, `folderInteger.json`), an absolute one (`http://example.com/…`), or
  // a URN — has nothing to resolve against and is refused. Loading the *other*
  // document is `@amritk/resolve-refs`' job by design (this package has no I/O
  // and no fetch), but the same-document `$id` cases below are resolvable in
  // principle and are the gap worth closing first.
  //
  // The refusal throws, so a schema in this shape fails loudly at the call site
  // rather than validating against a subset of what its author wrote.
  // ---------------------------------------------------------------------------
  'anchor.json/Location-independent identifier with absolute URI': 'base URI: `$anchor` reached through an `$id`',
  'anchor.json/Location-independent identifier with base URI change in subschema':
    'base URI: `$anchor` reached through an `$id`',
  'anchor.json/same $anchor with different base uri': 'base URI: two `$anchor`s disambiguated only by their `$id`',

  'defs.json': 'base URI: `$ref` to the 2020-12 metaschema, which is not bundled',

  'dynamicRef.json/A $dynamicRef resolves to the first $dynamicAnchor still in scope that is encountered when the schema is evaluated':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/A $dynamicRef without anchor in fragment behaves identical to $ref':
    'base URI: `$ref` written as a relative URI against `$id`',
  "dynamicRef.json/A $dynamicRef with intermediate scopes that don't include a matching $dynamicAnchor does not affect dynamic scope resolution":
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/An $anchor with the same name as a $dynamicAnchor is not used for dynamic scope resolution':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/A $dynamicRef without a matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/A $dynamicRef with a non-matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema without a matching $dynamicAnchor behaves like a normal $ref to $anchor':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/strict-tree schema, guards against misspelled properties':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/tests for implementation dynamic anchor and reference link': 'base URI: `$ref` to another document',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first':
    'base URI: `$ref` to another document',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first':
    'base URI: `$ref` to another document',
  'dynamicRef.json/$ref to $dynamicRef finds detached $dynamicAnchor': 'base URI: `$ref` to another document',
  'dynamicRef.json/$dynamicRef skips over intermediate resources - direct reference':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',

  'ref.json/remote ref, containing refs itself': 'base URI: `$ref` to the 2020-12 metaschema, which is not bundled',
  'ref.json/Recursive references between schemas': 'base URI: sibling resources addressed by their `$id`',
  'ref.json/refs with relative uris and defs': 'base URI: `$ref` resolved against a relative `$id`',
  'ref.json/relative refs with absolute uris and defs': 'base URI: `$ref` resolved against an absolute `$id`',
  'ref.json/$id must be resolved against nearest parent, not just immediate parent':
    'base URI: nested `$id`s compose into the base a `$ref` resolves against',
  'ref.json/order of evaluation: $id and $ref': 'base URI: `$ref` resolved against a sibling `$id`',
  'ref.json/order of evaluation: $id and $ref on nested schema': 'base URI: `$ref` resolved against a nested `$id`',
  'ref.json/simple URN base URI with $ref via the URN': 'base URI: URN `$id` as a ref target',
  'ref.json/URN base URI with URN and JSON pointer ref': 'base URI: URN `$id` as a ref target',
  'ref.json/URN base URI with URN and anchor ref': 'base URI: URN `$id` as a ref target',
  'ref.json/URN ref with nested pointer ref': 'base URI: URN `$id` as a ref target',
  'ref.json/ref to if': 'base URI: `$ref` to an `$id` on an `if` subschema',
  'ref.json/ref to then': 'base URI: `$ref` to an `$id` on a `then` subschema',
  'ref.json/ref to else': 'base URI: `$ref` to an `$id` on an `else` subschema',
  'ref.json/ref with absolute-path-reference': 'base URI: `$ref` is an absolute path against the base URI',

  'refRemote.json': 'base URI: every case here fetches another document, which this package deliberately does not do',

  'unevaluatedItems.json/unevaluatedItems with $dynamicRef':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',
  'unevaluatedProperties.json/unevaluatedProperties with $dynamicRef':
    'base URI: `$dynamicRef` written as a relative URI against `$id`',

  // ---------------------------------------------------------------------------
  // annotation: `contains` does not publish the items it matched
  //
  // `unevaluatedItems` consumes the item annotations its siblings produce.
  // `prefixItems`/`items` publish theirs; `contains` does not, so an item matched
  // only by a `contains` still reads as unevaluated. Both directions of the
  // mistake appear below — accepting an array that should fail, and rejecting one
  // that should pass — which is why this is listed as a gap rather than a
  // conservative approximation.
  // ---------------------------------------------------------------------------
  'unevaluatedItems.json/unevaluatedItems depends on adjacent contains/contains passes, second item is not evaluated':
    'annotation: an item matched by `contains` is not marked evaluated',
  'unevaluatedItems.json/unevaluatedItems depends on multiple nested contains/7 not evaluated, fails unevaluatedItems':
    'annotation: an item matched by `contains` is not marked evaluated',
  "unevaluatedItems.json/unevaluatedItems and contains interact to control item dependency relationship/only a's and c's are invalid":
    'annotation: an item matched by `contains` is not marked evaluated',
  'unevaluatedItems.json/unevaluatedItems with minContains = 0/all items evaluated by contains':
    'annotation: an item matched by `contains` is not marked evaluated',

  // ---------------------------------------------------------------------------
  // vocabulary: `$vocabulary` is not read
  //
  // A custom metaschema can switch the validation vocabulary *off*, after which
  // `minimum` and friends are annotations that never fail. Honouring that means
  // fetching the metaschema named by `$schema` and reading its `$vocabulary` —
  // I/O this package does not do. Everything stays enforced instead, which is the
  // stricter of the two answers.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: `$vocabulary` in a fetched metaschema cannot switch validation off',
}
