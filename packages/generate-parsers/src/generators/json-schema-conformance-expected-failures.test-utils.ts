import type { ExpectedFailures } from '../../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases the *strict* generated parsers do not
 * handle, each with the reason.
 *
 * 158 of 1299. The list exists so the boundary is exact rather than approximate:
 * `json-schema-conformance.test.ts` fails if a case listed here starts passing
 * (the entry must go) or if a case not listed here starts failing (a regression).
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one when a whole group or file falls to a single cause.
 * Look one up in `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * The sections separate the two kinds of gap that matter differently: the ones
 * that stop generation (`refused`, most of the `$id`-based refs) cost a build
 * error and can never produce a wrong verdict, while the ones above them —
 * `implied type`, `union`, `prototype chain`, `annotation` — are cases where a
 * parser is generated and gets the answer wrong.
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
  // union: composition with nothing to discriminate on
  //
  // A `oneOf`/`anyOf`/`allOf` whose branches carry no `type` gives the parser no
  // way to tell them apart, and the whole composition compiles to a pass-through —
  // so a value matching none of the branches (or, for `oneOf`, more than one) is
  // accepted. Discriminated unions and type-distinct branches, which is what the
  // generator is built for, are enforced; these are the shapes outside that.
  // ---------------------------------------------------------------------------
  'allOf.json/allOf combined with anyOf, oneOf/allOf: true, anyOf: false, oneOf: false':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'allOf.json/allOf combined with anyOf, oneOf/allOf: true, anyOf: false, oneOf: true':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'allOf.json/allOf combined with anyOf, oneOf/allOf: true, anyOf: true, oneOf: false':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'anyOf.json/anyOf/neither anyOf valid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'anyOf.json/anyOf with base schema/both anyOf invalid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'anyOf.json/anyOf with boolean schemas, all false':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'anyOf.json/nested anyOf, to check validation semantics/anything non-null is invalid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf/both oneOf valid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf/neither oneOf valid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with base schema/both oneOf valid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with boolean schemas, all true':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with boolean schemas, more than one true':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with boolean schemas, all false':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with empty schema/both valid - invalid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with required/both invalid - invalid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with required/both valid - invalid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with missing optional property/both oneOf valid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/oneOf with missing optional property/neither oneOf valid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',
  'oneOf.json/nested oneOf, to check validation semantics/anything non-null is invalid':
    'union: branches with no `type` give the parser nothing to discriminate on, so the composition compiles to no verdict \u2014 matching none of them (or, for `oneOf`, more than one) is still accepted',

  // ---------------------------------------------------------------------------
  // prototype chain: `required` uses `in`
  //
  // `"toString" in {}` is `true`, so a schema requiring `toString`, `constructor`
  // or `__proto__` is satisfied by an object that has none of them. The suite has
  // this group precisely to catch it. `Object.hasOwn` is the fix; the generated
  // *validators* already use it.
  // ---------------------------------------------------------------------------
  'required.json/required properties whose names are Javascript object property names/none of the properties mentioned':
    'prototype chain: `required` compiles to `in`, which finds inherited `toString`/`constructor`, so a missing property reads as present',
  'required.json/required properties whose names are Javascript object property names/__proto__ present':
    'prototype chain: `required` compiles to `in`, which finds inherited `toString`/`constructor`, so a missing property reads as present',
  'required.json/required properties whose names are Javascript object property names/toString present':
    'prototype chain: `required` compiles to `in`, which finds inherited `toString`/`constructor`, so a missing property reads as present',
  'required.json/required properties whose names are Javascript object property names/constructor present':
    'prototype chain: `required` compiles to `in`, which finds inherited `toString`/`constructor`, so a missing property reads as present',

  // ---------------------------------------------------------------------------
  // annotation: `unevaluated*` reads an incomplete evaluated set
  //
  // Where the strict parser does enforce `unevaluatedItems`/`unevaluatedProperties`
  // rather than refusing the schema, it misses two contributors: items matched by
  // an adjacent `contains`, and properties evaluated by an in-place applicator
  // sibling. Both directions of the mistake appear below.
  // ---------------------------------------------------------------------------
  'unevaluatedItems.json/unevaluatedItems with $dynamicRef/with no unevaluated items':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  'unevaluatedItems.json/unevaluatedItems depends on adjacent contains/contains passes, second item is not evaluated':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  'unevaluatedItems.json/unevaluatedItems depends on multiple nested contains/7 not evaluated, fails unevaluatedItems':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  "unevaluatedItems.json/unevaluatedItems and contains interact to control item dependency relationship/only a's and c's are invalid":
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  'unevaluatedItems.json/unevaluatedItems with minContains = 0/all items evaluated by contains':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  'unevaluatedProperties.json/unevaluatedProperties with $dynamicRef/with no unevaluated properties':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  'unevaluatedProperties.json/in-place applicator siblings, anyOf has unevaluated/base case: both properties present':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',
  'unevaluatedProperties.json/in-place applicator siblings, anyOf has unevaluated/in place applicator siblings, bar is missing':
    'annotation: `contains` and in-place applicator siblings do not publish what they evaluated, so `unevaluated*` reads the wrong set',

  // ---------------------------------------------------------------------------
  // pointer: `$ref` fragments are matched, not decoded
  //
  // A JSON Pointer is percent-decoded and `~0`/`~1`-unescaped before it is walked.
  // The ref graph compares the fragment as written, so a definition whose name
  // contains `%` or `"` — or a pointer with an empty token — is never found, and
  // generation stops.
  // ---------------------------------------------------------------------------
  'ref.json/escaped pointer ref':
    'pointer: a `$ref` fragment is matched literally, so `%25` / `%22` are never decoded back to `%` / `"`',
  'ref.json/refs with quote':
    'pointer: a `$ref` fragment is matched literally, so `%25` / `%22` are never decoded back to `%` / `"`',
  'ref.json/empty tokens in $ref json-pointer':
    'pointer: an empty JSON-Pointer token (`#/$defs//$defs/`) does not resolve',

  // ---------------------------------------------------------------------------
  // boolean subschema as a ref target
  //
  // `$defs: { bool: true }` is a legal definition, but the ref graph only names
  // object subschemas, so a `$ref` at it resolves to nothing.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/$dynamicRef points to a boolean schema':
    'boolean subschema: a `$defs` entry of `true`/`false` is not a definition the ref graph can name',
  'ref.json/$ref to boolean schema true':
    'boolean subschema: a `$defs` entry of `true`/`false` is not a definition the ref graph can name',
  'ref.json/$ref to boolean schema false':
    'boolean subschema: a `$defs` entry of `true`/`false` is not a definition the ref graph can name',

  // ---------------------------------------------------------------------------
  // refused: keywords strict mode cannot prove inline
  //
  // Strict mode's contract is that a parsed value provably satisfies the schema,
  // so a keyword it cannot inline stops generation instead of producing a parser
  // that would accept what the schema rejects. Cost: a build error, never a wrong
  // verdict. The coercing parser or `@amritk/runtime-validators` takes these.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/strict-tree schema, guards against misspelled properties':
    'refused: strict mode cannot prove `unevaluatedProperties` inline, and refuses rather than emit a parser that accepts what the schema rejects',
  'ref.json/ref to if':
    'refused: strict mode cannot prove `$ref` inline, and refuses rather than emit a parser that accepts what the schema rejects',
  'ref.json/ref to then':
    'refused: strict mode cannot prove `$ref` inline, and refuses rather than emit a parser that accepts what the schema rejects',
  'ref.json/ref to else':
    'refused: strict mode cannot prove `$ref` inline, and refuses rather than emit a parser that accepts what the schema rejects',
  'refRemote.json/base URI change':
    'refused: strict mode cannot prove `constraints` inline, and refuses rather than emit a parser that accepts what the schema rejects',
  'unevaluatedProperties.json/unevaluatedProperties + single cyclic ref':
    'refused: strict mode cannot prove `unevaluatedProperties` inline, and refuses rather than emit a parser that accepts what the schema rejects',

  // ---------------------------------------------------------------------------
  // base URI: refs that only resolve by applying `$id` (refused)
  //
  // The ref graph is walked within one document, by JSON Pointer and `$anchor`.
  // A `$ref` written against an `$id` — relative, absolute, or a URN — a
  // `$dynamicRef` resolved through the dynamic scope, and anything in another
  // document have no in-document target, and generation stops naming the ref.
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
  // base URI: refs that resolve, but to the wrong definition
  //
  // The cases the walker does not refuse: it finds *a* definition for the ref and
  // generates against it, where `$id` scoping or dynamic scope would have selected
  // another. Unlike the group above, these fail as a verdict rather than a build
  // error — the schema generates, and the parser is measured against a schema its
  // author did not write.
  // ---------------------------------------------------------------------------
  'anchor.json/same $anchor with different base uri/$ref resolves to /$defs/A/allOf/1':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/A $dynamicRef resolves to the first $dynamicAnchor still in scope that is encountered when the schema is evaluated/An array of strings is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/A $dynamicRef without anchor in fragment behaves identical to $ref/An array of numbers is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  "dynamicRef.json/A $dynamicRef with intermediate scopes that don't include a matching $dynamicAnchor does not affect dynamic scope resolution/An array of strings is valid":
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/An $anchor with the same name as a $dynamicAnchor is not used for dynamic scope resolution':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/A $dynamicRef without a matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/A $dynamicRef with a non-matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword/number list with string values':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword/string list with number values':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/tests for implementation dynamic anchor and reference link/correct extended schema':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first/incorrect parent schema':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first/incorrect extended schema':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first/incorrect parent schema':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first/incorrect extended schema':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/$dynamicRef skips over intermediate resources - direct reference/integer property passes':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered/data is sufficient for schema at second#/$defs/length':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/Recursive references between schemas/valid tree':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/order of evaluation: $id and $ref/data is valid against first definition':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/order of evaluation: $id and $ref on nested schema/data is valid against nested sibling':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/simple URN base URI with $ref via the URN/valid under the URN IDed schema':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/URN base URI with URN and JSON pointer ref/a string is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/URN base URI with URN and anchor ref/a string is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'ref.json/ref with absolute-path-reference/a string is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'refRemote.json/base URI change - change folder/number is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'refRemote.json/base URI change - change folder in subschema/number is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'refRemote.json/root ref in remote ref/string is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'refRemote.json/root ref in remote ref/null is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'refRemote.json/remote ref with ref to defs/valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',
  'refRemote.json/retrieved nested refs resolve relative to their URI not $id/string is valid':
    'base URI: the ref resolves, but to the definition the `$id` scope (or the dynamic scope) says it should not',

  // ---------------------------------------------------------------------------
  // arithmetic and regex flags
  //
  // Judgement calls rather than missing features. `multipleOf` compares the
  // quotient to its nearest integer within a scaled tolerance (the shared
  // `@amritk/helpers/multiple-of-check`); a quotient that overflows to `Infinity`
  // makes that comparison `NaN`, which the check reads as passing. And `pattern`
  // compiles without the `u` flag, so ECMAScript Unicode property escapes are
  // inert. Both shared with `@amritk/generate-validators`.
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
  // Switching the validation vocabulary off means fetching the metaschema named by
  // `$schema` — I/O the generator does not do — so everything stays enforced.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: `$vocabulary` in a fetched metaschema cannot switch validation off',
}
