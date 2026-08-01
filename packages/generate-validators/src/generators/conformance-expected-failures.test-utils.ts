import type { ExpectedFailures } from '../../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases the *generated* validators do not
 * handle, each with the reason.
 *
 * The generator is a build-time subset by design — it trades keyword coverage for
 * flat, readable, dependency-free output — so this list is long (312 of 1299
 * cases). Its job is to make that subset exact rather than approximate:
 * `conformance.test.ts` fails if a case listed here starts passing (the entry
 * must go) or if a case not listed here starts failing (a regression).
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one when a whole group or file falls to a single cause.
 * Look one up in `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * What is left divides cleanly in two. Nearly two thirds is `unevaluatedItems` /
 * `unevaluatedProperties`, which flat generated code cannot express and the
 * generator refuses outright. Almost all of the rest is one missing feature:
 * resolving a `$ref` through the `$id` base URI that encloses it. Both refuse at
 * generation with a message naming the cause, so neither can produce a wrong
 * verdict at runtime — the cost is a build error, never a validator that lies.
 * Three arithmetic/regex judgement calls and one `$vocabulary` case round it out.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // refused: `unevaluatedItems` / `unevaluatedProperties`
  //
  // Both depend on annotations collected across the whole applicator tree, which
  // flat generated code cannot carry. Generation stops with an explanation rather
  // than emit a validator that would quietly accept what the interpreter rejects,
  // so these cost a build error, never a wrong verdict — validate such a schema
  // with `@amritk/runtime-validators` instead.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/strict-tree schema, guards against misspelled properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "not.json/collect annotations inside a 'not', even if collection is disabled":
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'ref.json/ref creates new scope when adjacent to keywords':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems false':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems as schema':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with uniform items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with tuple':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with items and prefixItems':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested tuple':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested prefixItems and items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested unevaluatedItems':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with anyOf':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with oneOf':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with not':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with if/then/else':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with boolean schemas':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with $ref':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems before $ref':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with $dynamicRef':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "unevaluatedItems.json/unevaluatedItems can't see inside cousins":
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/item is evaluated in an uncle schema to unevaluatedItems':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems depends on adjacent contains':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems depends on multiple nested contains':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems and contains interact to control item dependency relationship':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with minContains = 0':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/non-array instances are valid':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with null instance elements':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems can see annotations from if without then and else':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/Evaluated items collection needs to consider instance location':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties schema':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties false':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent patternProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent bool additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent non-bool additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested patternProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested unevaluatedProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with anyOf':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with oneOf':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with not':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with if/then/else':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with if/then/else, then not defined':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with if/then/else, else not defined':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with dependentSchemas':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with boolean schemas':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with $ref':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties before $ref':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with $dynamicRef':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "unevaluatedProperties.json/unevaluatedProperties can't see inside cousins":
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "unevaluatedProperties.json/unevaluatedProperties can't see inside cousins (reverse order)":
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer false, inner true, properties outside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer false, inner true, properties inside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer true, inner false, properties outside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer true, inner false, properties inside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/cousin unevaluatedProperties, true and false, true with properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/cousin unevaluatedProperties, true and false, false with properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/property is evaluated in an uncle schema to unevaluatedProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/in-place applicator siblings, allOf has unevaluated':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/in-place applicator siblings, anyOf has unevaluated':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties + single cyclic ref':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties + ref inside allOf / oneOf':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/dynamic evalation inside nested refs':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/non-object instances are valid':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with null valued instance properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties not affected by propertyNames':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties can see annotations from if without then and else':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/dependentSchemas with unevaluatedProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/Evaluated properties collection needs to consider instance location':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/Evaluated properties collection needs to consider instance location with patternProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/Evaluated properties collection needs to consider instance location with additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',

  // ---------------------------------------------------------------------------
  // base URI: refs that only resolve by applying `$id`
  //
  // The ref graph is walked within one document, by JSON Pointer and `$anchor`.
  // A `$ref` written against an `$id` — relative, absolute, or a URN — and a
  // `$dynamicRef` resolved through the dynamic scope have no in-document target.
  // The same boundary `@amritk/runtime-validators` has, refused earlier: at
  // generation, with a message naming the ref.
  //
  // These are the ones the ref-graph walker itself catches, because the ref is
  // spelled as an in-document pointer or an absolute URI and simply resolves to
  // nothing.
  // ---------------------------------------------------------------------------
  'anchor.json/Location-independent identifier with absolute URI':
    'base URI: the target is another document, which the generator does not fetch',
  'anchor.json/Location-independent identifier with base URI change in subschema':
    'base URI: the target is another document, which the generator does not fetch',
  'defs.json': 'base URI: the target is another document, which the generator does not fetch',
  'dynamicRef.json/A $dynamicRef to an $anchor in the same schema resource behaves like a normal $ref to an $anchor':
    'base URI: `$dynamicRef` "#items" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope':
    'base URI: `$dynamicRef` "extended#meta" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema without a matching $dynamicAnchor behaves like a normal $ref to $anchor':
    'base URI: `$dynamicRef` "extended#meta" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef':
    'base URI: `$dynamicRef` "inner_scope#thingy" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/$ref to $dynamicRef finds detached $dynamicAnchor':
    'base URI: the target is another document, which the generator does not fetch',
  'ref.json/remote ref, containing refs itself':
    'base URI: the target is another document, which the generator does not fetch',
  'ref.json/refs with relative uris and defs': 'base URI: a nested `$id` re-bases the `#/$defs/...` pointers inside it',
  'ref.json/relative refs with absolute uris and defs':
    'base URI: a nested `$id` re-bases the `#/$defs/...` pointers inside it',
  'ref.json/$id must be resolved against nearest parent, not just immediate parent':
    'base URI: "http://example.com/b/d.json" resolves only by applying `$id` as a base URI',
  'ref.json/URN ref with nested pointer ref': 'base URI: a nested `$id` re-bases the `#/$defs/...` pointers inside it',
  'ref.json/ref to if': 'base URI: "http://example.com/ref/if" resolves only by applying `$id` as a base URI',
  'ref.json/ref to then': 'base URI: "http://example.com/ref/then" resolves only by applying `$id` as a base URI',
  'ref.json/ref to else': 'base URI: "http://example.com/ref/else" resolves only by applying `$id` as a base URI',
  'refRemote.json/remote ref': 'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/fragment within remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/anchor within remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/ref within remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/Location-independent identifier in remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/remote HTTP ref with different $id':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/remote HTTP ref with different URN $id':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/remote HTTP ref with nested absolute ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/$ref to $ref finds detached $anchor':
    'base URI: the target is another document, which the generator does not fetch',

  // ---------------------------------------------------------------------------
  // base URI (refused at generation): a ref the walker never even queues
  //
  // The same class of ref, spelled in a form nothing in the document could be
  // keyed by: a relative path (`int.json`, `node`), an absolute path
  // (`/absref/foobar.json`), or a URN. The walker skips those, the import
  // collector skips them — and the emitter, which only reads the ref *string*,
  // used to write `validateIntJson(...)` regardless. That shipped TypeScript
  // that does not compile, so the failure landed in the consumer's build instead
  // of next to the schema that caused it.
  //
  // `assert-generatable-refs.ts` now stops generation and names the ref, which is
  // the answer the resolvable-but-unsupported refs above already gave. These stay
  // conformance failures either way — refusing does not make the schema work, it
  // only puts the report in the right place. Closing them for real means
  // resolving `$ref` against the enclosing `$id`, which is a feature of its own.
  // ---------------------------------------------------------------------------
  'anchor.json/same $anchor with different base uri':
    'base URI (refused): `$ref` "child1#my_anchor" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/A $dynamicRef resolves to the first $dynamicAnchor still in scope that is encountered when the schema is evaluated':
    'base URI (refused): `$ref` "list" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/A $dynamicRef without anchor in fragment behaves identical to $ref':
    'base URI (refused): `$ref` "list" is written against an `$id`, so no file is ever generated for it',
  "dynamicRef.json/A $dynamicRef with intermediate scopes that don't include a matching $dynamicAnchor does not affect dynamic scope resolution":
    'base URI (refused): `$ref` "intermediate-scope" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/An $anchor with the same name as a $dynamicAnchor is not used for dynamic scope resolution':
    'base URI (refused): `$ref` "list" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/A $dynamicRef without a matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'base URI (refused): `$ref` "list" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/A $dynamicRef with a non-matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'base URI (refused): `$ref` "list" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword':
    'base URI (refused): `$ref` "numberList" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/tests for implementation dynamic anchor and reference link':
    'base URI (refused): `$ref` "extendible-dynamic-ref.json" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first':
    'base URI (refused): `$ref` "extendible-dynamic-ref.json" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first':
    'base URI (refused): `$ref` "extendible-dynamic-ref.json" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/$dynamicRef skips over intermediate resources - direct reference':
    'base URI (refused): `$ref` "item" is written against an `$id`, so no file is ever generated for it',
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered':
    'base URI (refused): `$ref` "first#/$defs/stuff" is written against an `$id`, so no file is ever generated for it',
  'ref.json/Recursive references between schemas':
    'base URI (refused): `$ref` "node" is written against an `$id`, so no file is ever generated for it',
  'ref.json/order of evaluation: $id and $ref':
    'base URI (refused): `$ref` "int.json" is written against an `$id`, so no file is ever generated for it',
  'ref.json/order of evaluation: $id and $ref on nested schema':
    'base URI (refused): `$ref` "nested/foo.json" is written against an `$id`, so no file is ever generated for it',
  'ref.json/simple URN base URI with $ref via the URN':
    'base URI (refused): the URN `$ref` names a `$id`, not a definition the document is keyed by',
  'ref.json/URN base URI with URN and JSON pointer ref':
    'base URI (refused): the URN `$ref` names a `$id`, not a definition the document is keyed by',
  'ref.json/URN base URI with URN and anchor ref':
    'base URI (refused): the URN `$ref` names a `$id`, not a definition the document is keyed by',
  'ref.json/ref with absolute-path-reference':
    'base URI (refused): `$ref` "/absref/foobar.json" is written against an `$id`, so no file is ever generated for it',
  'refRemote.json/base URI change':
    'base URI (refused): `$ref` "folderInteger.json" is written against an `$id`, so no file is ever generated for it',
  'refRemote.json/base URI change - change folder':
    'base URI (refused): `$ref` "baseUriChangeFolder/" is written against an `$id`, so no file is ever generated for it',
  'refRemote.json/base URI change - change folder in subschema':
    'base URI (refused): `$ref` "baseUriChangeFolderInSubschema/#/$defs/bar" is written against an `$id`, so no file is ever generated for it',
  'refRemote.json/root ref in remote ref':
    'base URI (refused): `$ref` "name-defs.json#/$defs/orNull" is written against an `$id`, so no file is ever generated for it',
  'refRemote.json/remote ref with ref to defs':
    'base URI (refused): `$ref` "ref-and-defs.json" is written against an `$id`, so no file is ever generated for it',
  'refRemote.json/retrieved nested refs resolve relative to their URI not $id':
    'base URI (refused): `$ref` "nested/foo-ref-string.json" is written against an `$id`, so no file is ever generated for it',

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

  // ---------------------------------------------------------------------------
  // vocabulary: `$vocabulary` in a custom metaschema
  //
  // A custom metaschema can switch the validation vocabulary off, after which
  // `minimum` and friends never fail. Reading it means fetching the metaschema
  // named by `$schema` — I/O the generator does not do — so everything stays
  // enforced instead.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: `$vocabulary` in a fetched metaschema cannot switch validation off',
}
