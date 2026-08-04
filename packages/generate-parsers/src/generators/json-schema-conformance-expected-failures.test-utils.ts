import type { ExpectedFailures } from '../../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases the *strict* generated parsers do not
 * handle, each with the reason.
 *
 * 41 of 1281. The list exists so the boundary is exact rather than approximate:
 * `json-schema-conformance.test.ts` fails if a case listed here starts passing
 * (the entry must go) or if a case not listed here starts failing (a regression).
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one when a whole group or file falls to a single cause.
 * Look one up in `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * What used to dominate this list was the cross-document `$ref`, and it is gone:
 * documents handed to the generator through its `schemas` registry are folded
 * into the one being generated, so a ref into `integer.json`, `tree.json` or the
 * 2020-12 metaschema resolves and is enforced like anything else. The generator
 * still does no I/O — the caller loads the documents — but it can now be told.
 *
 * The arithmetic and regex entries are gone as well, and closed by deferring to
 * `@amritk/runtime-validators` rather than by a fresh judgement call: `multipleOf`
 * now emits the interpreter's own two-branch check, and `pattern` compiles with
 * the `u` flag wherever the pattern admits it — the same try-`u`-then-fall-back
 * decision the interpreter makes at runtime, taken once at generation time.
 *
 * What is left divides into three kinds: a deliberate difference (`implied
 * type`), the `$dynamicRef` cases where one generated function is shared by
 * every path that reaches it, and shapes strict mode refuses rather than
 * under-enforce — which costs a build error and can never produce a wrong
 * verdict.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // implied type: object keywords compile to an object check
  //
  // `{ "required": ["foo"] }` says nothing about non-objects — a string satisfies
  // it — but a schema carrying `properties`/`required`/`patternProperties` is read
  // as an object schema, so a non-object is rejected rather than ignored. This one
  // is deliberate and documented (README, "Strict-mode validation coverage"): a
  // parser has to return the type it declares, and the declared type is an object.
  // Stricter than the spec, never looser.
  // ---------------------------------------------------------------------------
  'additionalProperties.json/additionalProperties being false does not allow other properties/ignores arrays':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'additionalProperties.json/additionalProperties being false does not allow other properties/ignores strings':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'additionalProperties.json/additionalProperties being false does not allow other properties/ignores other non-objects':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'patternProperties.json/patternProperties validates properties matching a regex/ignores arrays':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'patternProperties.json/patternProperties validates properties matching a regex/ignores strings':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'patternProperties.json/patternProperties validates properties matching a regex/ignores other non-objects':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/object properties validation/ignores arrays':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/object properties validation/ignores other non-objects':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/properties whose names are Javascript object property names/ignores arrays':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/properties whose names are Javascript object property names/ignores other non-objects':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'ref.json/root pointer ref/match':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'ref.json/root pointer ref/recursive match':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  // The URN `$id` now resolves; what is left is a recursive `$ref` back to a root
  // that declares `properties`, so the recursive slot is typed as that object.
  'ref.json/simple URN base URI with $ref via the URN/valid under the URN IDed schema':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores arrays':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores strings':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores other non-objects':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores null':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores boolean':
    'implied type: `properties`/`required`/`patternProperties` compile to an object check, so a non-object is rejected instead of ignored',

  // ---------------------------------------------------------------------------
  // dynamic scope: which `$dynamicAnchor` wins depends on the evaluation path
  //
  // A `$dynamicRef` binds to the outermost resource in the *dynamic scope* — the
  // chain of resources evaluation actually passed through — which a generator
  // cannot know, because it emits one function per definition and that function
  // is shared by every path that reaches it. The static approximation binds each
  // anchor name document-wide, first declaration winning, which is right for the
  // recursive-tree and `strict-tree` idioms and for every non-bookended reference
  // (those degrade to a plain `$ref`, which is now resolved through `$id` too).
  // These are the cases where the two answers differ. Use
  // `@amritk/runtime-validators`, which evaluates the scope as it walks.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef/string matches /$defs/thingy, but the $dynamicRef does not stop here':
    'dynamic scope: the anchor is bound document-wide (first declaration wins), not to the outermost resource the evaluation passed through',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef/first_scope is not in dynamic scope for the $dynamicRef':
    'dynamic scope: the anchor is bound document-wide (first declaration wins), not to the outermost resource the evaluation passed through',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword/number list with string values':
    'dynamic scope: one generated definition is shared by both paths, so the anchor cannot resolve differently per path',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword/string list with number values':
    'dynamic scope: one generated definition is shared by both paths, so the anchor cannot resolve differently per path',
  // `extendible-dynamic-ref.json` now resolves and its `$dynamicAnchor` is
  // applied — what is left is which anchor the extending schema's `$dynamicRef`
  // binds to, which is a property of the evaluation path rather than of the
  // document.
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first/incorrect parent schema':
    'dynamic scope: the extended anchor binds statically, so the extending schema’s constraint is not applied on this path',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first/incorrect extended schema':
    'dynamic scope: the extended anchor binds statically, so the extending schema’s constraint is not applied on this path',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first/incorrect parent schema':
    'dynamic scope: the extended anchor binds statically, so the extending schema’s constraint is not applied on this path',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first/incorrect extended schema':
    'dynamic scope: the extended anchor binds statically, so the extending schema’s constraint is not applied on this path',

  // ---------------------------------------------------------------------------
  // refused: keywords strict mode cannot prove inline
  //
  // Strict mode's contract is that a parsed value provably satisfies the schema,
  // so a keyword it cannot inline stops generation instead of producing a parser
  // that would accept what the schema rejects. Cost: a build error, never a wrong
  // verdict. Every one of these is a schema that refers back into itself, which
  // the inline matcher will not unroll. The coercing parser or
  // `@amritk/runtime-validators` takes them.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/strict-tree schema, guards against misspelled properties':
    'refused: strict mode cannot prove `unevaluatedProperties` inline through a recursive `$ref`, and refuses rather than emit a parser that accepts what the schema rejects',
  'unevaluatedProperties.json/unevaluatedProperties + single cyclic ref':
    'refused: strict mode cannot prove `unevaluatedProperties` inline through a cyclic `$ref`, and refuses rather than emit a parser that accepts what the schema rejects',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope':
    'refused: the ref now resolves, but the resulting cycle leaves the root’s sibling `const` unprovable inline, so generation stops rather than drop it',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema without a matching $dynamicAnchor behaves like a normal $ref to $anchor':
    'refused: the ref now resolves, but the resulting cycle leaves the root’s sibling `const` unprovable inline, so generation stops rather than drop it',

  // ---------------------------------------------------------------------------
  // name collision: two embedded resources, one definition name
  //
  // Each resource carries its own `$defs/stuff`, and both reduce to the file
  // `stuff.ts`. Emitting one would silently give every reference to the other the
  // wrong type, so the walker stops and says which two definitions clash. Renaming
  // has to be the caller's call — the name is what every emitted import is keyed on.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered':
    'name collision: `first`, `second`, and `third` each declare `$defs/stuff`, which all reduce to one filename',

  // ---------------------------------------------------------------------------
  // vocabulary: `$vocabulary` in a custom metaschema
  //
  // Switching the validation vocabulary off means fetching the metaschema named by
  // `$schema` — I/O the generator does not do — so everything stays enforced.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: `$vocabulary` in a fetched metaschema cannot switch validation off',
}
