# @amritk/generate-parsers

## 0.19.1

### Patch Changes

- 4178e8d: Patch release across all packages.
- Updated dependencies [4178e8d]
  - @amritk/helpers@0.15.1

## 0.19.0

### Minor Changes

- de0952c: Make both generators agree with Draft 2020-12 — and with each other — on
  structural equality, tuple `items`, `oneOf`, and prototype-member property names.

  The two generators disagreed with Ajv and with one another on the same schemas.
  Where they differed, `generate-validators` was usually right: it already shipped
  `valuesEqual` / `allUnique`, which `generate-parsers` never adopted.

  **`@amritk/generate-validators`**

  - A property named `__proto__` was silently dropped. The `nullable` rewrite runs
    over _every_ schema and copied `properties` with a plain assignment, which fires
    the `Object.prototype` setter instead of creating a key — so
    `{"properties":{"__proto__":{"type":"string","minLength":3}}}` emitted a
    validator with no checks at all, and `required: ["__proto__"]` degraded to a
    bare presence check. A validation bypass.
  - `constructor` / `toString` / `hasOwnProperty` properties were read straight off
    the object, so the _prototype's_ value answered: a valid document was reported
    as `must be string` at `/hasOwnProperty`, and a required `toString` could never
    be reported missing (`'toString' in obj` is always true). Reads now go through
    an own-property guard, and presence uses `Object.hasOwn` — but only for the
    names that can actually be inherited. Every other key keeps the plain `in` it
    always had, because `Object.hasOwn` is a call the engine cannot fold the way it
    folds `in`, and spending it on `id` or `name` bought nothing while costing
    roughly half the throughput on an all-present object.
  - `items` alongside `prefixItems` was applied to the prefix positions too. Per
    2020-12 `items` is the tail schema, so `{prefixItems:[{type:'string'}],
items:{type:'number'}}` rejected `["a", 1, 2]` — which Ajv accepts, and which
    the `[string?, ...number[]]` type this generator emits already admits.
  - `enum` members that are objects or arrays could never match: `.includes` is
    SameValueZero, i.e. reference equality. `enum` now compares structurally via
    `valuesEqual`, the way `const` always has — which also makes `isX` a sound type
    guard again.

  **`@amritk/generate-parsers`**

  - The same `prefixItems` + `items` defect, in both the fast path and the strict
    assertion.
  - The same `enum`-with-object-members defect. Members are now compared by an
    unrolled structural check against the known literal.
  - `const` deep equality used `JSON.stringify`, which is key-order sensitive, so
    `{b: 2, a: 1}` was rejected against `const: {a: 1, b: 2}` — and it serialized the
    whole value on every call to do it.
  - `uniqueItems` used a `JSON.stringify` dedupe key (or a bare `Set`, which
    compares objects by reference), so `[{a:1,b:2},{b:2,a:1}]` was accepted where
    Ajv and `generate-validators` both reject. It now projects through a
    key-order-independent canonical form when items may be structural, keeping the
    cheap native `Set` when they are provably scalar. A root array of objects
    skipped the constraint entirely and now enforces it.
  - `oneOf` exclusivity was not enforced — both `oneOf` and `anyOf` compiled to a
    plain disjunction, so a value matching two branches was accepted. `oneOf` now
    requires exactly one match.
  - The array fallback was a bare `[]`, ignoring `prefixItems` and `minItems`. It is
    not an instance of its own schema, and against a required closed tuple it is not
    even assignable — `TS2322: Type '[]' is not assignable to type '[string,
number]'` made non-strict and `readonly` output fail to compile.
  - A schema property named after an `Object.prototype` member produced an
    unsatisfiable type: TypeScript reads the inherited `constructor: Function` on the
    fallback object literal and rejects it against `constructor?: string`.

  Both packages now type-check their generated output under the repo's real
  compiler flags (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), not
  `strict` alone — `generate-validators` had no such suite at all — and both pin the
  semantics above against Ajv (or, for prototype-member names, against
  `@amritk/runtime-validators`, since Ajv has those bugs itself).

- 213ecc4: Take documents you already loaded, so a `$ref` to another document generates

  **On the official JSON Schema Test Suite: `generate-validators` 1238 → 1268 /
  1281 (99.0%), `generate-parsers` 1222 → 1237 / 1281 (96.6%).**

  Both generators gain a `schemas` option: documents you have already loaded, keyed
  by the absolute URI a `$ref` names them by. It is the build-time counterpart of
  `@amritk/runtime-validators`' `ValidateOptions.schemas`, and it keeps the same
  promise — nothing is fetched, you cannot pass a URL, only a document. What changes
  is that "we do no I/O" no longer also means "we cannot be told".

  A cross-document `$ref` was the single largest gap in both packages, and it is
  gone. `refRemote.json` passes in full; so do the `dynamicRef.json` groups that
  reach `tree.json` and `extendible-dynamic-ref.json`, and — with the dialect
  metaschema registered — `defs.json` and `ref.json`'s "remote ref, containing refs
  itself".

  Each registered document becomes a resource of the document being generated: its
  `$id`, its `$anchor`s and `$dynamicAnchor`s and its own embedded resources all
  resolve, a `$ref` from one registered document into another resolves, and every
  definition reached gets a file, a type and a validator/parser by the ordinary
  rules. A document with no `$id` resolves its relative `$ref`s against the URI it
  was registered under; one whose `$id` disagrees answers to both. Registering more
  than the schema uses costs nothing — only the documents actually reached are
  emitted — and a `$ref` to a URI nobody registered still stops the build with a
  message naming the ref.

  The mechanism is one pass, not a second addressing mode. `@amritk/helpers` gains
  `graftExternalSchemas`, which embeds the registered documents into the root before
  the `$id` pass, and `pruneExternalSchemas`, which drops the unreferenced ones once
  the refs are pointers and reachability is finally knowable. Everything downstream —
  the ref-graph walk, the naming, the emitted import graph — keeps working on a
  single document and needed no change. `walkRefGraph` carries the option and
  memoizes per `(schema, schemas)` by identity.

  **Fixed: a root schema with a union `type` dropped every sibling constraint.**
  `{ type: ['object', 'boolean'], properties: {…}, required: [...] }` emitted the
  type check and nothing else, so it accepted any object at all. The multi-type root
  branch now emits the shared constraint checks the single-type and combinator
  branches already did; they carry their own runtime-type guards, so a member of the
  union a constraint does not apply to is still untouched. This is the shape the
  2020-12 metaschema's own root is written in, which is how it went unnoticed — the
  generated dialect validator accepted `{ type: 1 }` as a valid schema.

  `@amritk/runtime-validators` is unchanged in behaviour; its conformance figures are
  restated against the corpus that is actually vendored (1281 cases, not 1299 — the
  README's count never matched, and upstream's `content.json` is not among the
  vendored files). The suite's `remotes/` loader moves to the shared fixtures
  bookkeeping so all four conformance suites use one walk.

- 5afbfd4: Resolve `$ref` against `$id` as a base URI in the ref graph

  A `$ref` written against an enclosing `$id` — a relative URI (`list`,
  `folderInteger.json`), an absolute one, or a URN — used to either stop generation
  or, worse, find _a_ definition and generate against it, so the emitted parser
  enforced a schema its author did not write. On the official JSON Schema Test
  Suite, strict-parser generation goes from 1180/1299 to **1222 / 1299 (94.1%)**;
  all 29 of the resolve-to-the-wrong-definition cases became right rather than
  refused.

  Three new pieces in `@amritk/helpers`, deliberately free of any parser or
  validator concepts:

  - **`build-resource-registry`** — one walk producing the document's embedded
    resources, anchors and dynamic anchors, each `$id` composed against the base of
    its parent. Keyed by JSON Pointer, because that is the currency the rest of the
    package already deals in — a registry hit turns straight into a `$ref` string, a
    filename, or a type name. Returns `null` for a document with no `$id`, which is
    the fast-path switch, and is memoized per document.
  - **`resolve-scoped-ref`** — one call covering relative, absolute, absolute-path,
    URN, pointer-into-resource and anchor-in-resource forms, plus the plain
    `#/$defs/x` that under an enclosing `$id` means _that resource's_ `$defs`.
  - **`normalize-ref-scopes`** — rewrites every `$ref`/`$dynamicRef` to a
    document-root pointer. This is the leverage: everything downstream already
    resolves refs by string against the root, so one normalization makes ref
    resolution, type naming, the import graph and the strict matcher correct at once,
    none of them needing base-URI awareness of their own.

  It is wired into `walkRefGraph`, so `@amritk/generate-validators` and
  `@amritk/generate-examples` inherit it.

  `assertIdScopes` keeps its name and signature but changes meaning: it no longer
  refuses any document with nested `$id` scoping, only the residue base-URI
  resolution cannot place — a fragment ref inside an embedded resource that declares
  its own targets and names none of them. That preserves the property worth having:
  never silently pick the outer definition.

  `@amritk/generate-parsers` additionally follows the spec on `contains` next to
  `unevaluatedItems`: only the items `contains` matched are evaluated, not the whole
  array. That is what `@amritk/runtime-validators` does, so the two stop disagreeing
  about the same schema. Ajv marks the whole array, so the single fuzz fragment
  pairing those keywords leaves the Ajv-oracle corpus (with the reason recorded next
  to it) and unit tests plus the conformance suite cover it instead; every other
  `contains` and `unevaluated*` fragment keeps fuzzing.

- eb80ca6: Fix `$ref`-graph naming and reference resolution, and stop degrading silently.

  Generation now fails loudly instead of writing output that cannot work:

  - Two definitions that reduce to one filename (`Pet`/`pet`) or one type name
    (`foo-bar`/`foo.bar`/`fooBar` all become `FooBar`) are an error. The filename
    case used to drop one definition and give every reference to it the other
    one's shape; the type-name case emitted both files and left the importer with
    two `import { FooBar }` lines that do not parse.
  - An unresolvable `$ref` is an error. It used to warn while the generators still
    emitted the type name and the parser/validator call for a file that was never
    written.
  - A `$dynamicRef` with no `$dynamicAnchor` to bind to is an error. Leaving it in
    place made the type generator name the type after the anchor, so the canonical
    recursive-tree idiom (`$dynamicAnchor: "node"`) produced a reference to the
    DOM's `Node` interface — a clean compile with the wrong type.
  - A document that relies on `$id` base-URI scoping is rejected rather than
    resolving its inner fragments against the document root and silently selecting
    a different definition.
  - Every recursive schema walker enforces a nesting cap and reports it by name
    instead of dying with a bare stack-overflow.

  And several things that were broken now work:

  - Non-ASCII definition names (CJK, Cyrillic, accented) keep their characters
    instead of collapsing onto the single type name `_`, and the generated
    `index.ts` barrel re-exports them correctly.
  - A root-level `$dynamicAnchor` is generated as the root's own file, so the
    2020-12 recursive-tree idiom produces a real self-referencing type.
  - A plain `$anchor` ref (`$ref: "#named"`) resolves, instead of producing the
    unloadable import specifier `'./#named.ts'`.
  - Derived filenames are normalized: no more `.ts`, `...ts`, `http:--x.ts`, or
    characters Windows and ESM specifiers reject. `$ref: "#/__proto__"` no longer
    resolves to `Object.prototype`.
  - Generated readers guard `Object.prototype` member names (`constructor`,
    `toString`, `__proto__`, …) with `Object.hasOwn`, so a schema with a
    `constructor` property no longer fails its own shape check for every valid
    object, and the parser no longer fabricates a `__proto__` key.
  - `x-mjst` `instanceOf` is allow-listed to the classes the generators support,
    so an arbitrary identifier is warned about and ignored instead of being
    emitted verbatim into the output.

- 2c9982c: Fix the published manifests so the packages install, resolve, and dedupe correctly

  **Types resolve on TypeScript's default config.** Every package was
  exports-only: nine declared `"module": "./dist/index.js"` (a field neither Node
  nor TypeScript reads) and nothing declared `types`. A consumer on
  `moduleResolution: "node10"` — still the default when `module` is `commonjs` —
  cannot see `exports` at all, so `import { lintDocument } from '@amritk/lint'`
  failed with `TS2307: Cannot find module '@amritk/lint' or its corresponding type
declarations`. Each package with a `.` export now also declares `main` and
  `types`; `@amritk/helpers` and `@amritk/adapters` have no `.` export (they are
  subpath-only), so they declare a `typesVersions` wildcard mapping instead, which
  gives their subpaths the same node10 fallback. All of it is ignored under
  `node16`/`nodenext`/`bundler`, where `exports` still wins.

  **`workspace:*` resolves to a caret, not an exact pin.** All fourteen
  inter-package edges shipped as exact versions, so installing two `@amritk/*`
  packages published at different times pulled in two copies of their shared
  dependency. That is not merely wasteful: the module-level caches those packages
  rely on are per-copy, so the `WeakMap` validator cache in
  `@amritk/runtime-validators` silently stopped hitting. Pre-1.0 a caret stays
  narrow (`^0.9.1` is `>=0.9.1 <0.10.0`) and breaking changes here already ride a
  minor bump.

  **`@amritk/helpers` stops shipping 21 source files it does not need.** Embedded
  mode reads four helper sources (`is-object`, `validate-array`,
  `validate-record`, `has-ref`) out of the installed package at generation time,
  so `src` has to ship — but only those four. `files` now lists them explicitly
  instead of globbing all of `src`, cutting the tarball from 78 files / 206 kB to
  63 / 112 kB.

  **Two packages no longer declare a dependency they never import.**
  `@amritk/mjst` and `@amritk/generate-parsers` both listed
  `@amritk/generate-markdown` under `dependencies`, but the only importer is each
  package's `scripts/generate-readme.ts`, which is not published. Both moved to
  `devDependencies`. `@amritk/adapters` likewise dropped its
  `@sinclair/typebox` peer dependency: the TypeBox adapter is purely structural
  (it strips symbol keys) and imports nothing. `valibot` stays — it is a genuine
  transitive peer of `@valibot/to-json-schema`.

  **`@amritk/mjst` fixes.** `json-schema-typed` moved to `dependencies`, because
  the shipped `dist/emit-examples.d.ts` imports types from it. The package gained
  an `exports` map, so it is no longer deep-importable in its entirety. And the
  build now marks `dist/cli.js` executable: `npm pack` records on-disk modes, and
  package managers only `chmod` bin targets when they link them, so flows that
  consume the tarball directly (vendoring, Docker `npm pack` + `tar -x`) hit
  `EACCES`.

- fa8620c: Stop strict parsers accepting what the schema forbids: prototype-inherited
  `required`, undiscriminated unions, and `$ref` fragments that were never decoded

  Measured against the official JSON Schema Test Suite, strict-mode generation goes
  from 1141/1299 to **1180/1299 (90.8%)**. Four defects, all of them cases where the
  generated parser said yes to a document the schema says no to — or refused one it
  should have taken.

  - **`required` compiled to `in`, which walks the prototype chain.** `"toString" in {}`
    is `true`, so `{ "required": ["__proto__", "toString", "constructor"] }` was
    satisfied by an object carrying none of them. `Object.hasOwn` now covers the
    names an object can actually inherit, and plain `in` stays everywhere else so
    ordinary keys keep the form the engine can fold — the same split
    `@amritk/generate-validators` already made. Generated output for ordinary keys is
    byte-identical. Applies to `required`, `dependentRequired`, `dependentSchemas`,
    and `false`-property absence.
  - **A `oneOf`/`anyOf`/`allOf` whose branches carry no `type` compiled to a
    pass-through.** `{ "oneOf": [{ "type": "integer" }, { "minimum": 2 }] }` emitted
    `parseRoot = (input) => input`: nothing to discriminate on meant nothing was
    checked, so a value matching _no_ branch — or, for `oneOf`, more than one — was
    accepted. Those compositions are now enforced through the existing subschema
    matcher, and only where the flat union check declines, so nothing is checked
    twice and the common discriminated-union path is unchanged.
  - **`$ref` fragments were matched literally, never decoded.** `#/$defs/percent%25field`,
    `#/$defs/foo%22bar` and `#/$defs//$defs/` (an empty pointer token) resolved to
    nothing, and generation stopped. Tokens are now percent-decoded before `~1`/`~0`
    unescaping, per token, and empty tokens are significant. Two consequences worth
    knowing: a definition whose name literally contains `%25` must now be written
    `%2525`, and `#/$defs//x` now means the `""` member rather than silently meaning
    `#/$defs/x`. `#/` still means the document root.
  - **A boolean `$defs` entry was not a ref target.** `$defs: { bool: true }` is a
    legal definition; the ref graph only named object subschemas, so a `$ref` at it
    resolved to nothing. Boolean entries in a definition map now expand to their
    object equivalents (`true` → `{}`, `false` → `{ not: {} }`) — confined to
    definition maps, because elsewhere `additionalProperties: true` and `{}` generate
    different _types_.

  `@amritk/helpers` carries the last two (`resolve-ref`, `walk-ref-graph`) plus the
  new `hasOwnCheck`/`missingCheck` emitters in `safe-accessor`.

### Patch Changes

- 9cb45a0: Emit the interpreter's own `multipleOf` check, and compile `pattern` in Unicode
  mode — closing the last two places where generated code and
  `@amritk/runtime-validators` could disagree about a document.

  `@amritk/helpers/multiple-of-check` claimed to mirror the interpreter and had
  drifted from it. The interpreter splits on the divisor (an exact `%` when it is
  an integer, a quotient within `2·ε·|q|` when it is not); the emitter still
  divided in every case and allowed `1e-8·|q|` — roughly 10⁷× the actual
  representation error. Generated validators and parsers therefore **accepted
  values the interpreter rejects**: `1000000.005` against `multipleOf: 0.01` (a
  half-cent past a whole dollar amount) passed, and so did any value whose quotient
  overflows to `Infinity`, because the old fail expression asked `NaN > tolerance`
  and got `false`. The emitter now produces the interpreter's two branches
  verbatim, so both verdicts flip to invalid and the two implementations agree
  again. `0.3` still satisfies `multipleOf: 0.1`, which is what the tolerance is
  for.

  A `pattern` now compiles with the `u` flag wherever the pattern admits one, the
  same try-`u`-then-fall-back decision the interpreter makes at runtime, taken once
  at generation time by the new `regexLiteral` / `regexFlagsFor` in
  `@amritk/helpers/escape-regex-pattern`. Without the flag a Unicode property
  escape is inert — `\p{Letter}` was read as a literal `p{Letter}` — and `^.$`
  rejected a single astral character. Every emit site now goes through
  `regexLiteral` rather than interpolating an escaped body into its own `/…/`, so
  the flag decision is made in one place instead of at a dozen call sites.

  Measured against the official JSON Schema Test Suite, this closes three cases in
  each generator: `@amritk/generate-validators` moves to **1271 / 1281 (99.2%)**
  and strict `@amritk/generate-parsers` to **1240 / 1281 (96.8%)**.

- ef77708: Reject `NaN` against a numeric bound, matching `@amritk/runtime-validators`.

  Bounds were emitted as their direct failure condition (`x < minimum`) rather than
  the negated pass condition (`!(x >= minimum)`). The two agree on every ordinary
  value and are opposite for `NaN`, which compares `false` against every operator:
  the direct form read that as "not out of bounds" and let a `NaN` through
  `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`, where the
  interpreter and Ajv both reject it. Generated validators, strict generated
  parsers, and the compiled API engine's inlined guards all now write the negated
  form — so a `NaN` fails a bounded number everywhere in the toolchain. A bare
  `{ type: 'number' }` with no constraint still accepts it, as Ajv does; only a
  bound or `multipleOf` rejects it.

  Two internal inconsistencies close with it: `@amritk/generate-parsers` emitted the
  un-negated `x >= min` in its inline matchers and the direct `x < min` in its
  strict assertions, so the same schema could answer differently depending on which
  path ran, and `@amritk/api`'s compiled engine disagreed with its own runtime
  engine for a value the two are documented to be observationally identical on.

  `interpreter-parity.test.ts` now covers the numeric keywords — bounds, the
  draft-04 boolean `exclusive*` form, and `multipleOf` across integer, fractional,
  and quotient-overflowing divisors — over a value set built to separate the two
  spellings (`NaN`, `±Infinity`, `1e308`, `1000000.005`). Nothing pinned these
  before, which is how the drift got in.

- 798fd7a: Measure every schema-consuming package against the official JSON Schema Test
  Suite, the way `@amritk/yaml` is measured against the YAML test suite

  The required Draft 2020-12 tests (46 files, 383 groups, 1299 cases) are vendored
  under `fixtures/json-schema-test-suite`, and four packages now run them on every
  build. Each carries an expected-failure list naming every case it does not pass
  and why, and each suite fails when a case moves in **either** direction — a
  regression breaks the build, and so does a case that starts passing while its
  entry stays behind. Nothing is published: the corpus and the harnesses live
  outside every `files` list.

  | package                       | measured on                                      | rate                |
  | ----------------------------- | ------------------------------------------------ | ------------------- |
  | `@amritk/runtime-validators`  | `validate` and `validateGuard` verdicts          | 1250 / 1299 (96.2%) |
  | `@amritk/generate-parsers`    | strict parsers, generated → linked → executed    | 1180 / 1299 (90.8%) |
  | `@amritk/generate-validators` | generated predicate validators, likewise         | 987 / 1299 (76.0%)  |
  | `@amritk/resolve-refs`        | verdict preserved after inlining (`$ref` corpus) | 160 / 170 (94.1%)   |

  The generators are measured through the code they emit, not the source text they
  emit: each suite schema is generated whole, compiled, and linked in memory, so the
  `$ref`'d sibling files and the embedded runtime helpers run too. `resolve-refs`
  has no verdicts of its own, so it is held to semantic preservation — the resolved
  document must accept exactly what the original did, judged by
  `@amritk/runtime-validators` over the cases the interpreter already answers
  correctly, which is the population where a resolution bug is visible and nothing
  else is.

  Those rates are where the packages _end up_. The suites were written first and
  found real defects — a validator that accepted everything for a schema without a
  `type`, `required` satisfied by an inherited `toString`, refs that emitted
  uncompilable output, `$ref`-shaped data inlined as a reference — each fixed in its
  own commit alongside this one. What remains is documented case by case, and each
  package's README carries a "Conformance, measured" section with its number and the
  reasons behind it.

- f439570: Bring the strict parser up to Ajv's assertion vocabulary, and stop refusing the
  keywords it can now prove.

  The exact subschema matcher — the thing strict mode enforces `contains`,
  `propertyNames`, `not` and `dependentSchemas` through — only understood a
  fraction of Draft 2020-12, and every gap in it became either a generation-time
  refusal or a keyword nothing checked. It now covers `$ref` (JSON Pointer,
  `$anchor`, and the 2020-12 rule that a ref's _siblings_ still apply),
  `prefixItems` with its `items` tail, `items: false`, `contains` with
  `minContains` / `maxContains`, `patternProperties`, a schema-valued
  `additionalProperties`, `propertyNames`, `dependentRequired`,
  `dependentSchemas`, array-form `type`, structural `const`, and an empty `enum`.

  Built on that:

  - **`unevaluatedProperties` / `unevaluatedItems` are implemented** rather than
    rejected at generation time. The emitted check computes the same annotation
    coverage the runtime interpreter collects — keys and indices evaluated by
    `properties`, `patternProperties`, `additionalProperties`, `prefixItems`,
    `items`, a satisfied `contains`, `allOf` members, a `$ref` target, a _matching_
    `anyOf` / `oneOf` branch, an `if` / `then` / `else` arm, and a triggered
    `dependentSchemas` entry — and applies the unevaluated schema to what is left.
  - **A backstop check** now stands behind the per-property assertions, so the
    keywords no flat check can express are enforced instead of dropped: a
    `$ref` that no imported parser validates (single-file builds, `allOf` members
    of a property-less object, array `items`, tuple positions), a `$ref` with
    constraining siblings, `items: false`, and constraint keywords with no `type`
    to hang them on (`{ minimum: 5 }`, `{ required: ['a'] }`). The fast path and
    the shape validator decline for those same shapes, so nothing can skip past
    the check. It proves only the keywords that need it — a bare `required` stays
    enforceable even when a sibling `allOf` member is too deep to inline — so the
    whole 982-schema OpenAPI corpus still generates under `strict`, now covered by
    its own pass in the fixture suite.
  - **A `type` with more than one non-null member** keeps each family's
    constraints: `{ type: ['string','array'], minLength: 3, minItems: 2 }` bounds
    the string by length and the array by count.
  - **`minLength` / `maxLength` count Unicode code points**, as JSON Schema
    specifies — `"💩"` no longer satisfies `minLength: 2`, and `"💩💩"` no longer
    violates `maxLength: 2`. The exact count is only scanned inside the narrow band
    where the cheap UTF-16 unit count cannot decide, so ASCII input allocates
    nothing and `minLength: 1` compiles to a plain length test.
  - **A `false` schema rejects every value** instead of casting it through, and a
    strict `if` / `then` / `else` root asserts the conditional instead of building
    a result from the branch fragments (which invented properties the input never
    had).
  - **A nullable object root** (`type: ["object","null"]` with `properties`) accepts
    `null`, which the object parser's `isObject` guard used to reject.
  - **A recursive root `$ref: "#"`** is generated as the root's own type, the way a
    root `$dynamicAnchor` already was. It previously emitted an import of a
    `ref-<hash>.ts` that was never generated — output that did not compile at all.
  - The generation-time guard walks _schema_ positions only. It used to inspect
    every object in the document, so a schema declaring a property named `items`,
    `not` or `contains` was checked as though the property name were the keyword.

  Parity is held by a new differential fuzz suite (`parser-vocabulary-conformance`)
  over that vocabulary, plus the existing shape, composition and strict fuzzers,
  with Ajv 2020 as the oracle. Three departures from Ajv are deliberate and
  documented in the README: `format` stays an annotation (Ajv's own default),
  `multipleOf` keeps the magnitude-scaled tolerance the whole toolchain shares, and
  a type-less schema with `properties` still requires an object because the parser
  must return the type it declares.

- cb0ef39: Close the strict parser's silent-acceptance gaps across the composition and
  constraint keywords. A strict parser promises to throw on anything the schema
  rejects; each of these was accepted instead, because the keyword appeared in
  neither the fast-path guard nor the slow-path assertions:

  - `const` on a property — scalar, structural (compared by deep equality, key
    order included) and `const: null`.
  - `minProperties` / `maxProperties` — at the root, on a property, and on the
    property-less object and record parsers.
  - `required` on a schema with no `properties`.
  - `not`, at the root and on a property. Enforced through the exact subschema
    matcher; a subschema the matcher cannot prove is now a generation-time error,
    joining `contains` / `propertyNames` / `dependentSchemas`.
  - `allOf` members that carry constraints rather than an object shape, and object
    members of a type-less `allOf` root.
  - `if` / `then` / `else`.
  - `patternProperties` value schemas, and the value constraints of a
    schema-valued `additionalProperties` beyond its bare `type`.
  - Array `items` richer than a scalar or enum — a nested array, a union, a
    bounded string — which previously contributed no element check at all.
  - `minItems` / `maxItems` on a root array whose items are objects or `$ref`s.
  - The object shape (`properties`, `required`, …) of a nullable
    (`["object","null"]`) property.
  - Boolean property schemas: `false` now rejects the key, and `true` no longer
    blanks the value to `undefined` — which made a strict parser mutate a value it
    had just accepted.

  The fast-path guard and the exported shape validator decline any schema carrying
  a keyword they cannot mirror, so a value can no longer be waved through before
  the assertions run. `subschemaMatchExpr` gained `allOf` / `anyOf` / `oneOf` /
  `not` / `if`-`then`-`else` support (so `contains`, `propertyNames`,
  `dependentSchemas` and array items handle combinators too), switched
  `uniqueItems` to the structural comparison the rest of the package uses, and
  casts its object accessors so the generated code type-checks.

  A new differential fuzz suite holds this surface against Ajv.

- Updated dependencies [213ecc4]
- Updated dependencies [9cb45a0]
- Updated dependencies [5afbfd4]
- Updated dependencies [eb80ca6]
- Updated dependencies [2c9982c]
- Updated dependencies [f439570]
- Updated dependencies [fa8620c]
  - @amritk/helpers@0.15.0

## 0.18.0

### Minor Changes

- fe8191b: Close the gaps between the emitted TypeScript types and the schemas they come from

  The shared type generator read past several keywords, so the type it emitted
  described fewer documents than the schema allowed — and the parsers built from
  it disagreed with it. Generating the whole vendored OpenAPI corpus (982
  component schemas, 5,872 files) and compiling the result under `strict` went
  from 667 type errors to none.

  **Types**

  - `nullable: true` (OpenAPI 3.0) now widens the type with `| null` — 432
    occurrences in the vendored corpus were previously typed as non-null, which
    also made `generate-validators`' `input is T` predicate unsound, since its
    validator accepts null.
  - An array-form `type` keeps the shape it declares: `["object","null"]` with
    properties is `{ … } | null` instead of `Record<string, unknown> | null`, and
    `["array","null"]` keeps its item type. Members are deduplicated, and
    `readonly` applies to them.
  - `prefixItems` (and the draft-07 array form of `items`) emits a tuple instead
    of `unknown[]`, with positions optional past `minItems` and the tail typed
    from the sibling `items`/`additionalItems`.
  - Keywords declared _alongside_ `properties` are no longer dropped: `allOf`
    members written inline (not just `$ref`s) and sibling `oneOf`/`anyOf` unions
    are intersected in, `additionalProperties`/`patternProperties` become an index
    signature, and a nested schema with both `properties` and a union keeps both.
  - A `description` or `$comment` containing a comment terminator no longer ends
    the JSDoc block early — a glob like `**/*.ts` in a description used to make
    the whole generated file unparseable.
  - A URI `$ref` that resolves inside the document is named rather than typed
    `unknown`, matching the import the same file already emits for it.

  **Parsers**

  - An array-form `type` is enforced: strict parsers assert the disjunction (plus
    the constraints of the non-null member) instead of emitting no check at all,
    and the shape validator keeps a real fast path instead of degrading to a stub.
  - Inline `allOf` members are enforced in strict mode, and the fast path no
    longer jumps over those assertions.
  - A `required` key with no declared property is asserted present.
  - Tuple positions declared with the draft-07 array `items` are checked.
  - A `default` that contradicts its declared `type` is ignored rather than used
    as a coercion target.
  - Root-level tuple and item assertions are emitted once, not twice.
  - A file no longer imports from itself when a definition's name collides with
    the root type name, and colliding definition names are reported: two that
    reduce to one filename mean only the first is generated.

### Patch Changes

- 65771d4: Repair the workspace type check and complete the published manifests

  `bun run types:check` had been failing for three packages and nothing in CI ran
  it. `@amritk/lint`, `@amritk/runtime-validators`, and `@amritk/yaml` were the
  only tsconfigs without the `**/*.test.ts` exclude the other nine carry, so their
  test files pulled the shared OpenAPI fixture loader into the program, where its
  `@amritk/resolve-refs` / `@amritk/yaml` imports do not resolve from the repo
  root. CI now runs `types:check` alongside the lint and test steps.

  Every package declares `engines: { node: '>=20' }`, matching the Node target the
  CLI already emits for, so an install on an older runtime warns instead of
  failing at run time. Every library also declares `sideEffects: false` so bundlers
  can tree-shake them — relevant to `@amritk/runtime-validators`, `@amritk/lint`,
  and `@amritk/yaml`, which are built to ship into browsers and Workers. The CLI
  is excluded: its bin runs on import.

  `@amritk/runtime-validators` no longer depends on `json-schema-typed`. It never
  imported the package, and the dependency was installed by every consumer of the
  one package whose design goal is staying self-contained.

- Updated dependencies [65771d4]
- Updated dependencies [fe8191b]
  - @amritk/generate-markdown@0.4.5
  - @amritk/helpers@0.14.0

## 0.17.2

### Patch Changes

- Updated dependencies [217cb66]
  - @amritk/helpers@0.13.5

## 0.17.1

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
  - @amritk/generate-markdown@0.4.4
  - @amritk/helpers@0.13.4

## 0.17.0

### Minor Changes

- 57d617a: Smaller generated parsers — the fast-path guard now calls the `validate{Type}Shape` predicate that already ships in the same file instead of inlining a byte-identical copy of the whole check chain. On the OpenAI OpenAPI spec (888 generated files) the bundled + minified output drops ~8% (703 kB → 645 kB); the duplicated guard chains were the single largest source of repeated bytes in generated code.

  The substitution is proven safe per parser: the generator renders the shape predicate its guard would need and delegates only when it matches the emitted one byte-for-byte — composition keywords, conditional flattening, alias/union predicates, and stub validators all keep the inline guard exactly as before. Exported `additionalProperties: false` / `stripUnknown` parsers also keep it, because their literal-return fast path would otherwise pay double property reads (a measured 6–13% hot-path cost on the strict benches). With the guard delegated, the cached property reads move below the fast-path return, so clean input skips them entirely; benchmarks are within noise of the previous output across all parse cases.

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/generate-markdown@0.4.3
  - @amritk/helpers@0.13.3

## 0.16.3

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
- Updated dependencies [4e23c02]
  - @amritk/generate-markdown@0.4.2
  - @amritk/helpers@0.13.2

## 0.16.2

### Patch Changes

- f2857b6: Fix cases where the coercing parser "repaired" input into a value that was still invalid, and a prototype-pollution hazard in case-insensitive enum coercion:

  - **`integer` coercion** now yields a whole number (or the default) instead of leaving a non-integral value like `1.5` in place — the repaired value previously still failed the schema's integrality check. This matches the root-level integer parser.
  - **Array-form `type`** (e.g. `["string","null"]`) now derives its default from the first listed type, so a missing/mistyped required value coerces to a valid member instead of `undefined` (which violated both `required` and the declared type).
  - **`caseInsensitive` enum coercion** now uses a `Map` rather than a plain object. A folded key that collides with an inherited member (`constructor`, `toString`, `__proto__`, …) no longer skips the member at generation time or returns an `Object.prototype` value at runtime; it resolves to the fallback (or the correct member).

- 248a412: Fix strict mode silently coercing declared properties in the combined `properties` + `patternProperties` parser. That parser builds its result from the _coercing_ property lines, so in strict mode a wrong-typed declared property was repaired and a missing required key was defaulted instead of throwing (e.g. `{ count: 'nope' }` → `{ count: 0 }`). It now asserts the declared properties (type, required, enum, constraints) via the shared strict assertion before building the result, so strict mode throws as documented. Unknown-key rejection (`additionalProperties: false`) and coerce mode are unchanged. (Note: `patternProperties` _values_ are still not type-asserted in strict mode — a separate, narrower gap.)
- 69b9841: Close two cases where a strict-mode parser silently coerced input instead of throwing (strict mode is documented to reject any violation):

  - **Root scalar constraints.** A root (non-object) scalar parser asserted only the `typeof`, so `{ type: 'string', minLength: 5 }`, `{ type: 'number', minimum: 10 }`, `pattern`, `multipleOf`, a typed or type-less `enum`, and `const` all passed through unvalidated. Root scalars now assert their full constraint set (and a type-less `enum`/`const` root asserts membership).
  - **Typed records.** `{ type: 'object', additionalProperties: { type: 'number' } }` in strict mode wrapped the _coercing_ value parser, so `{ a: 'x' }` became `{ a: 0 }`. Strict record values now throw on the wrong type (and integer values enforce integrality); coerce mode still repairs as before.

- a676e8d: Fix `stripUnknown` dropping keys that `patternProperties` declares. For a schema with `patternProperties` (and no `additionalProperties: false`, no `$ref` pattern), the parser fell back to the plain object parser, whose strip logic only knows the declared `properties` — so `stripUnknown` removed pattern-matching keys along with genuinely-undeclared ones. `{ a, patternProperties: { '^x-': ... } }` with input `{ a: 'ok', 'x-keep': 'yes', junk: 'x' }` dropped `x-keep`. The coerce-mode `stripUnknown` path now uses the selective combined copy, keeping declared and pattern-matching keys and dropping only the truly-undeclared ones — matching the interpreter.
- Updated dependencies [797a156]
  - @amritk/helpers@0.13.1

## 0.16.1

### Patch Changes

- 47fe796: Fix bugs surfaced by a security/correctness audit of the parser generator:

  - Prototype safety: the parsers generated for `patternProperties` (and
    `properties` + `patternProperties`) with `additionalProperties: false` now
    guard their dynamic `for..in` key copy against `__proto__`, matching the
    existing `validateRecord` hardening. Previously a `__proto__` input key
    (own-enumerable via `JSON.parse`) matching a pattern reassigned the result
    object's prototype instead of being stored as an own property.
  - `Record<string, integer>` coercion now rejects non-integral numbers
    (`Number.isInteger`) instead of passing `1.5` through unchanged, matching
    every other integer site and strict mode.
  - `x-mjst` `Date` coercion no longer yields an `Invalid Date`: a value that
    cannot be parsed falls back to the default (required) or `undefined`
    (optional) rather than producing an `instanceof Date` object whose every
    operation is `NaN`.
  - A declared property literally named `__proto__` is emitted as a computed key
    (`["__proto__"]:`) so it becomes a real own property instead of triggering
    the object-literal prototype-setter form.

  All fixes sit on cold/coercion branches or add a single `===` to a loop already
  running a regex test per key, so hot paths are unaffected.

- c74cd35: fix: enforce JSON Schema keywords that strict parsers previously ignored.

  Strict-mode parsers silently accepted input violating `contains` /
  `minContains` / `maxContains`, `dependentRequired`, `dependentSchemas`, and
  `propertyNames` — none of these keywords appeared anywhere in the generator, so
  a strict parser contradicted its "throws on violations" contract. Ported the
  enforcement from `@amritk/generate-validators`:

  - **`contains` / `minContains` / `maxContains`** — a strict parser now throws
    unless the number of array items matching the `contains` subschema is within
    `[minContains (default 1), maxContains (default ∞)]`. `minContains: 0` makes
    the lower bound trivially satisfied. Enforced on both array properties and
    root arrays (including arrays of `$ref`/object items).
  - **`dependentRequired`** — when a trigger key is present, its declared
    dependencies must be present too.
  - **`dependentSchemas`** — when a trigger property is present, the whole object
    must match the associated subschema (`false` forbids the trigger; `true` is a
    no-op).
  - **`propertyNames`** — every object key must satisfy the name subschema,
    including the common constrained-key-map form (`{ type: 'object',
propertyNames: { … } }`) with no declared `properties`.

  Enforcement is backed by a self-contained, both-directions-sound subschema
  matcher (type-aware, so `propertyNames: { maxLength: 3 }` correctly constrains
  keys). The parser fast path, shallow guard, and shape validator all bail when a
  schema carries one of these keywords, so a clean-input fast path can never skip
  the checks.

  Also adds a generation-time guard (strict mode only, mirroring the validators'
  `assertNoUnsupportedKeywords`): generating a strict parser now throws for
  `unevaluatedProperties` / `unevaluatedItems` with a constraining value, and for
  a `contains` / `propertyNames` / `dependentSchemas` subschema the generator
  cannot prove inline (a `$ref`, a combinator, …) — instead of silently emitting a
  permissive parser. Coercing (non-strict) parsers are unchanged: they are
  documented to repair rather than reject, so they still ignore these keywords.

- 297ccba: Parse and assert JSON Schema 2020-12 tuples (`prefixItems`) per position. The
  generated parsers previously left tuple positions untouched — every `items`
  code path bailed on the array form, so a mistyped position was never coerced
  (safe mode) or rejected (strict mode) and the value fell through to a generic
  cast, despite the README listing tuples as handled.

  Now, mirroring the validators' tuple handling:

  - Safe mode coerces each declared position through its own subschema and, when
    a sibling `items: false` (or draft `additionalItems: false`) caps the length,
    drops any element past the tuple. A shorter input keeps its absent trailing
    positions; a non-array coerces to an empty array.
  - Strict mode asserts each present position against its subschema (scalar type,
    enum, or a `$ref`/inline schema resolved via the root document) and throws on
    extra elements when the length is capped.
  - The fast-path type check and shape validators require a tuple's present
    positions to be well-typed, so a mistyped tuple is routed to the coercing or
    asserting slow path instead of short-circuiting through the fast path.

- 8e4cd38: fix: infer a branch's type from its keywords when generating union
  discrimination checks. Previously a `oneOf`/`anyOf` branch written without an
  explicit `type` (e.g. `{ properties, required }` or `{ minLength: 1 }`) emitted
  no checks and matched anything, breaking discrimination. `generateSchemaChecks`
  now infers `object` from `properties`/`required`/etc., `array` from
  `items`/`minItems`/`maxItems`, `string` from `minLength`/`pattern`, `number`
  from `minimum`/`multipleOf`, `boolean`/`null` from `const`, and `null` from an
  all-null `enum`, scoring keyword categories and resolving ties in
  `object > array > string > number` order.
- Updated dependencies [9bf3330]
- Updated dependencies [e612130]
  - @amritk/helpers@0.13.0

## 0.16.0

### Minor Changes

- 161c2fc: Add a `caseInsensitive` option for case-insensitive `enum`/`const` coercion.

  When enabled, a coercing parser normalizes a mis-cased string to the exact casing of the declared `enum`/`const` member it matches case-insensitively (e.g. `hElLo` → `hello`) instead of coercing it to the default. It applies to object properties, array items, and top-level enum/const parsers. Coerce mode only — strict parsers still reject a casing mismatch.

  Performance is unaffected on already-valid input: the exact `===` fast path (and the shape validators / deep guards built on it) is unchanged, and the case-insensitive lookup is emitted only on the coercion failure branch, so a correctly-cased value never runs it.

  `buildSchema` takes a new trailing `caseInsensitive` argument; `mjst` exposes it as the `--case-insensitive` flag and the `caseInsensitive` config key.

## 0.15.0

### Minor Changes

- 1bb7a25: Default generated relative imports to the literal `.ts` extension so the output
  runs under Node without a build step.

  Generated `.ts` files imported siblings as `./x.js` — the TS NodeNext form Bun
  and tsc resolve to the `.ts` file, but Node's type stripping (Node ≥ 22.18)
  throws `ERR_MODULE_NOT_FOUND` because it does not remap `.js` → `.ts`. The CLI
  now defaults `--import-ext` (config key `importExt`) to `ts`, emitting the
  literal on-disk paths, so `node generated/index.ts` loads and parses directly.

  `js` remains available for consumers who compile the output, and `--build`
  still selects `js` automatically (tsc cannot emit from `.ts` specifiers). tsc
  consumers running the `.ts` sources directly must set
  `allowImportingTsExtensions` — documented in the CLI README. `--import-ext ts`
  combined with `--build` stays an error.

- 1bb7a25: Derive the root type name from the schema instead of always using `Document`
  (breaking).

  The root type is now named after the schema — its `title`, falling back to the
  schema filename in PascalCase (`program.json` → `Program`, `spec-plan.json` →
  `SpecPlan`), and only then to `Document`. Generating from two schemas no longer
  forces import aliasing: the functions become `parseProgram` /
  `validateProgramShape` and nested types `SpecPlan_AxiomsItem`. A new
  `--root-type <Name>` flag overrides the name for a single `--schema` run; it is
  rejected with `--schema-dir`, where each schema derives its own root.

  This is breaking for consumers importing `parseDocument` / `validateDocumentShape`
  today — update those imports to the new schema-derived names.

  Fixed a latent generator bug this surfaced: a JSON Schema meta-schema special
  case (a pass-through, validation-free parser) fired on any type literally named
  `Schema`. It now applies only to `$ref`-reached definitions, so a common
  `schema.json` root gets a real parser instead of a silent pass-through.

### Patch Changes

- Updated dependencies [1bb7a25]
  - @amritk/helpers@0.12.0

## 0.14.0

### Minor Changes

- 91dab2b: Validate nested enums and $refs inside array items, closing the last
  array-element gap from downstream use:

  - Array properties whose `items` is an inline object schema now get a private
    item sub-parser and shape predicate (`OrderLinesItem` for `Order.lines`),
    wired through `validateArray` in both modes: strict mode throws on a bad
    element value (including nested enum and `$ref` violations), coerce mode
    repairs each element to a valid instance. Previously such elements passed
    through with only an `Array.isArray` check. Fast paths and the exported
    `validate{Type}Shape` predicates prove every element via the item predicate.
  - Enum array items are coerced element-wise in lax mode (a non-member becomes
    a member instead of leaking through), matching how enum properties already
    behaved.
  - Root-level array definitions delegate rich item schemas to a real parser:
    `$ref` items call the imported parser via `validateArray`, inline object
    items get a local `{Type}Item` sub-parser. Previously both were spread
    through unchecked even in strict mode.
  - The strict-union trust walk (`canEnforceUnion`) now mirrors the emitted
    shape validators _deeply_: a `$ref` branch whose validator is built on a
    stubbed sub-predicate (e.g. an inline object or array-item schema containing
    an uncheckable property) is no longer trusted, so strict union enforcement
    can never reject valid input through a conservative stub.

  The Ajv differential fuzzer's oracle now keeps `items` for enum and
  inline-object item schemas, so element conformance is fuzz-checked instead of
  out of scope.

  Fast-path optimizations recover (and beyond the array-items case, beat) the
  throughput cost of the new element validation:

  - When every declared property is required, the no-undeclared-keys test is an
    own-key count (`Object.keys(input).length === N`, sound because the typed
    checks prove all N keys present) instead of a per-key `for..in` walk — this
    also speeds up closed nested objects that were already validated before.
  - Array-item guards use a generated loop helper instead of
    `Array.prototype.every`'s callback protocol.
  - A _private_ nested-object or array-item parser in strip mode hands a clean
    value (already exactly the declared shape, proven by its deep guard) back by
    reference instead of allocating a rebuild — the same sharing the parent
    fast-path literal already performs — and evaluates that guard as the shallow
    guard plus only its residual terms, so a carries-extras value never runs the
    same typed checks twice. Exported root parsers still return a fresh object.

  Two subtle semantic notes come with this: the own-key-count fast path only
  fires for plain objects (`Object.getPrototypeOf(input) === Object.prototype`),
  so a crafted prototype cannot satisfy the typed checks through inherited
  properties — non-plain inputs take the slow path, where the historical
  `for..in` rejection of inherited enumerable keys still applies. And strip-mode
  output may share identity with clean nested input values (it always shared
  them for `{ ...input }` fast paths). `validateArray` — a published
  `@amritk/helpers` API — likewise returns the input array by reference when
  every element parses to itself, materializing a copy lazily on the first
  replaced element, so clean arrays cost no allocation; exported root-array
  parsers still hand back a fresh container by copying exactly when that
  identity return happens.

  Bench delta vs the previous release on the Order shape (array of closed
  3-field items): strict parse throughput is now at or slightly above par
  instead of −23%, safe (strip) mode retains a single-digit cost (−4 to −12%
  across runs, from −19%) for stripping elements it previously ignored, and the
  count form makes several closed shapes faster than before (`User · strict`
  +14%, `assert-strict` +80%).

  Generation itself is also faster, offsetting the larger emitted output: the
  index barrel recovers export names with a single char-prefiltered line-start
  walk instead of multiline-regex scans, `collectHelpers` detects helper usage
  in one alternation pass instead of four full-text `.includes` scans,
  `escapeRegexPattern` memoizes its validating `new RegExp` compile, the
  per-node schema walks drop their Set/Map/tuple allocations
  (`exactKeyCountOf`, `collectInlineSubTypes`, `Object.entries` loops), and
  plain assertion messages skip the `JSON.stringify` escaper via the new
  `@amritk/helpers` export `quoteJsString`, which centralizes the decision of
  how to emit schema-controlled text as a JS string literal (plain-text fast
  path, full escaping for anything carrying quotes, backslashes, controls, or
  line separators). These changes are
  output-identical (verified byte-for-byte against the previous generator);
  `buildSchema` on shapes without array items runs 15-30% faster than the
  previous release, and the array-item shapes build at roughly previous-release
  speed despite emitting ~30% more code.

  A new strict-mode differential fuzzer (700 random schemas × 8 mutated inputs
  per mode, Ajv as the oracle) pins the accept/reject contract of plain strict
  and strict+stripUnknown parsing across arbitrary shapes — and immediately
  caught a long-standing hole it now guards: `type: 'null'` properties were
  never enforced on the strict assertion path, so non-null values sailed
  through. Strict parsers now throw `expected null, got ...` like any other
  type mismatch.

- 9253843: Add `--import-ext <js|ts>` (config key `importExt`) to control the extension
  emitted on relative import specifiers in generated output — cross-file `$ref`
  imports, the `index.ts` barrel, and embedded `_helpers/` imports.

  The default stays `js` (the standard TS NodeNext form, required by `--build`).
  Passing `ts` emits the literal on-disk paths so the generated `.ts` sources run
  directly under Node's type stripping (Node 22.6+ with
  `--experimental-strip-types`, on by default from Node 23) with no compile step.
  `--import-ext ts` is rejected in combination with `--build`, since tsc refuses
  to emit from `.ts` specifiers.

  `buildSchema` gains a trailing `importExt` parameter, and
  `generateIndexBarrel` accepts an `importExt` option.

### Patch Changes

- Updated dependencies [91dab2b]
- Updated dependencies [9253843]
  - @amritk/helpers@0.11.0

## 0.13.0

### Minor Changes

- 02f6b05: Close the generated-parser validation gaps found by the 0.7.15 evaluation:

  - File-level union definitions (e.g. a recursive `expr` oneOf) now generate a
    real membership shape validator and a strict parser that throws on values
    matching no branch — recursively through branch `$refs` — instead of a
    `=> false` stub and a blind cast.
  - A root `$ref` whose derived name collides with its definition (title `Expr`
    → `#/$defs/expr`) now merges the definition into the root file instead of
    emitting a self-importing wrapper that could not compile; non-colliding
    alias roots delegate their parser and shape validator to the target.
  - `oneOf`/`anyOf` object properties are validated in strict mode (throw when
    no variant matches) and included in shape validators and fast paths, gated
    on every branch being provably checkable so a conservative stub validator
    can never reject valid input.
  - Enum properties participate in shape validators and fast paths instead of
    forcing the `=> false` stub, so `validate{Type}Shape` no longer rejects
    valid input containing nested enums.
  - Strict mode enforces array item types (scalars and enums) on the slow path
    and for root-level array schemas — a `string[]` field can no longer carry
    numbers past a strict parser.

### Patch Changes

- 18df9f7: Fix the published build shipping an unparseable regex. tsc-alias's
  `--resolveFullPaths` pass rewrote the embedded-helper import-rewrite pattern
  inside the compiled output, leaving v0.12.3 (and the mjst 0.7.15 CLI on top of
  it) crashing with `SyntaxError: Invalid regular expression` on load. The
  pattern now starts with a word boundary that keeps tsc-alias from matching it,
  and a new dist smoke test (`bun run test:dist`) loads every compiled module
  under plain Node and runs the CLI from `dist/` in CI and before every publish
  so build-step corruption can no longer ship.
- Updated dependencies [02f6b05]
  - @amritk/helpers@0.10.3

## 0.12.3

### Patch Changes

- 1efd6e8: Close generated-parser gaps reported from downstream use:

  - **Recursive discriminated `$ref` unions** are now validated. A top-level
    `oneOf`/`anyOf` of `$ref` branches sharing a discriminator dispatches to the
    branch parsers (e.g. `_disc === "lit" ? parseLit(input) : …`) in both strict and
    non-strict mode, instead of emitting a blind `input as T` cast that let
    mis-shaped values through. A `const` discriminator tag is also predicable now,
    so a discriminated branch's shape validator is a real predicate rather than the
    `=> false` stub.
  - **Strict parsers enforce array constraints** (`minItems`/`maxItems`/
    `uniqueItems`), which were silently unenforced even in `--strict`.
  - **Node ESM imports**: all emitted relative imports carry a `.js` extension
    (cross-file `$ref` imports, the index barrel, embedded `_helpers`, the
    validators' `validation-result`, and the examples' arbitrary imports). Node's
    ESM resolver rejects extensionless relative specifiers.
  - **Embedded-mode packaging**: `@amritk/helpers` now publishes its `src/*.ts`
    helper sources, and parser generation falls back to the always-published
    compiled `dist/*.js` when they are absent — fixing the `bunx mjst` crash that
    read an unpublished `src/is-object.ts`.

- c288a90: Security and robustness hardening:

  - **resolve-refs**: the SSRF guard now rejects non-`http(s)` redirect targets, so a
    remote schema can no longer bounce a fetch to `file://`/`data:` and disclose
    local files; remote fetches also gain a timeout and a response-size cap.
  - **generate-parsers / generate-validators / helpers**: schema-controlled strings
    (property names, enum values, patterns, required keys) are now escaped via
    `JSON.stringify` before being emitted into generated TypeScript. Previously a
    crafted enum value or property name could break out of — or inject code into —
    the generated output.
  - **runtime-validators**: recursive `$ref` schemas (e.g. `{ $ref: '#' }`) no longer
    overflow the stack; property presence is checked with `Object.hasOwn`, fixing a
    false-accept of an inherited `constructor` and a false-reject of a real
    `__proto__` property.
  - **yaml**: alias expansion is bounded (billion-laughs protection) and parser
    nesting is depth-limited, so a tiny adversarial document can no longer hang the
    process or overflow the stack.
  - **helpers / yaml / resolve-refs**: `__proto__` keys in untrusted input are stored
    as own data instead of mutating an object's prototype.

- Updated dependencies [1efd6e8]
- Updated dependencies [4501ff0]
- Updated dependencies [c288a90]
  - @amritk/helpers@0.10.2
  - @amritk/generate-markdown@0.4.1

## 0.12.2

### Patch Changes

- Updated dependencies [dc740e4]
- Updated dependencies [3e6f49d]
  - @amritk/generate-markdown@0.4.0

## 0.12.1

### Patch Changes

- Updated dependencies [9afc4cc]
- Updated dependencies [7d43e6f]
  - @amritk/generate-markdown@0.3.0
  - @amritk/helpers@0.10.1

## 0.12.0

### Minor Changes

- 8517631: Make the coercing parser return a value that is actually a valid instance of the
  generated type, closing gaps a new Ajv conformance differential test surfaced:

  - `enum`: a non-member now coerces to the first member (both at the top level and
    for properties) instead of passing through — the generated type is the literal
    union, so any other value was not of that type.
  - top-level `const` now coerces a non-matching value to the const value.
  - top-level `anyOf` / `oneOf` now validate membership and default an unmatched
    value to a member-shaped value, instead of passing input through unchanged.
  - `type: 'null'` is now coerced to `null` at the top level and for properties.
  - the non-object fallback and object-property coercion now fill required `const`,
    `null`, and nested-object properties with complete defaults (a shared
    `getDefaultValue`), so the fallback object is itself valid rather than `{}`.

  - inline array elements of a scalar item type are now coerced — a `number[]`
    given `[1, 'x', true]` becomes `[1, 0, 1]` — at the top level and for
    properties. The fast path now requires every element to already be well-typed,
    so a mistyped element routes the array to the coercing slow path. Object,
    union, and `$ref` array items keep their existing handling (`$ref` items are
    already parsed per-element; object/union items are not deeply coerced).

## 0.11.1

### Patch Changes

- 113f979: perf(generate-parsers): build the strict fast-path result as a declared-key field literal instead of `{ ...input }`

  When a strict (or `additionalProperties: false`) parser's deep guard fires, it
  has already proven the input's keys are exactly the declared properties (the
  `_hasOnlyKnownKeys` term). The fast path now returns an explicit field literal of
  those keys rather than spreading the input. The result is identical — same keys,
  same shared values — but a fixed-shape literal is materially faster than a generic
  spread, yields a stable hidden class, and matches the slow path's declared key
  order. Coerce parsers that intentionally keep undeclared keys still spread.

## 0.11.0

### Minor Changes

- 6fa79a6: Reshape the generated strict object parser to be guard-first, so a valid input is
  no longer validated twice before being copied. Previously the strict parser ran
  the full per-property assertion list and _then_ the fast-path shape check before
  returning `{ ...input }`; now the cheap shape guard runs first and the
  per-property assertions only run to pinpoint the error when the guard rejects the
  input — mirroring the validator hot/cold split. The strict build also assigns
  each field straight from its checked value instead of re-running the coercion
  ternaries, which are dead once the guard (or the assertions) have proven the
  type.

  `stripUnknown` gains a dedicated shallow-guard fast path: a well-typed input
  skips the assertions and goes straight to the strip build (which removes extras
  and recurses into each sub-parser), so the common parse-and-strip case is no
  longer forced down the slow path by the extras it is about to remove.

  The exported parser API and all behaviour (throws, strips, rejects) are
  unchanged. On the `moltar/typescript-runtime-type-benchmarks` parse shapes this
  lifts steady-state valid throughput notably on parseSafe (e.g. ~9.3M→~12.3M on
  the small shape, ~3.6M→~5.3M on the nested order shape) and on parseStrict for
  the codegen-heavy nested shapes.

## 0.10.0

### Minor Changes

- d1be238: Add a `stripUnknown` option to `@amritk/generate-parsers` (a `buildSchema` /
  `generateFile` / `generateParserFunction` option, the `stripUnknown` config key,
  and the `--strip-unknown` CLI flag; default `false`). When enabled, generated
  parsers build their result from the schema's declared properties only, silently
  dropping undeclared input keys at every nesting level — zod's `.strip()` / the
  `parseSafe` benchmark semantics — without treating extras as a validation error.
  It reuses the existing strict-keys machinery: the `{ ...input }` spread is dropped
  in the slow path and the fast path is gated on the `_hasOnlyKnownKeys` predicate.
  It composes with `strict` (still throws on wrong types and missing required
  properties, but strips extras instead of throwing on them) and yields to
  `additionalProperties: false`, where rejecting still wins over stripping in strict
  mode.

## 0.9.0

### Minor Changes

- 89a445a: `additionalProperties: false` now respects `patternProperties` in both
  generators, matching the runtime interpreter: a key that matches any declared
  pattern is no longer treated as an undeclared key.

  - **Validators.** The unknown-key sweep exempts pattern-matched keys. The
    patterns are compiled once at module scope (the same regex caching the
    interpreter does) and a key survives the sweep if it is in the known-keys Set
    or matches any pattern.
  - **Parsers.** Schemas with `patternProperties` plus `additionalProperties:
false` previously kept every key via a blanket `...input` spread. The parser
    now builds a selective copy: declared properties and pattern-matched keys are
    kept (the first `$ref` pattern is still coerced through its imported parser),
    and keys matching neither are rejected in strict mode (`unknown property
"key"`) or stripped in coerce mode. This applies to both the combined
    (properties + patternProperties) and pattern-only parsers.

  The remaining scope edge is composition: schemas combining
  `additionalProperties: false` with `allOf`/`anyOf`/`oneOf` still skip the
  undeclared-key handling, since per JSON Schema `additionalProperties` does not
  see properties introduced by those branches and resolving them correctly is
  `unevaluatedProperties`-shaped work.

### Patch Changes

- cdfe681: Speed up the `additionalProperties: false` unknown-key sweep in generated
  parsers and validators. For objects with up to 16 declared properties, the
  sweep now tests each key against an inline chain of `!==` comparisons instead of
  a hoisted `Set.has` lookup — the shape Ajv and TypeBox compile to, which V8
  evaluates faster for small key counts and which avoids the per-module `Set`
  allocation. Objects with more declared keys keep the `Set` fallback.

  The shared logic lives in a new `@amritk/helpers/unknown-key-check` export so the
  parser's strict-mode, warning, and `patternProperties` combined sweeps and the
  validator's strict sweep stay in step (the combined parser uses the matching
  `isKnown` form to skip declared keys without a per-call `Set`). Roughly triples
  valid throughput on small strict schemas in the benchmark suite.

- Updated dependencies [cdfe681]
  - @amritk/helpers@0.10.0

## 0.8.0

### Minor Changes

- 1eefe88: Generated parsers now validate inline nested objects and respect
  `additionalProperties: false`, matching the runtime interpreter and the
  just-fixed validator generator:

  - **Inline nested objects get a private sub-parser.** An object schema written
    directly under `properties` (rather than `$ref`'d) previously only passed an
    `isObject` check — its fields were never parsed, in either mode. Each inline
    nested object now gets a non-exported sub-parser, shape predicate, and type
    alias (`type OrderShipTo = Order["shipTo"]`) in the same generated file, and
    parsing recurses to any depth: coerce mode coerces nested fields (and builds
    deep defaults for non-object input), strict mode throws path-aware errors
    like `[OrderShipTo] field "zip" expected string, got number`.
  - **`additionalProperties: false` is enforced.** Strict mode throws
    `[TypeName] unknown property "key"`; coerce mode strips undeclared keys from
    the result instead of spreading them through (previously extras — including
    a potential `__proto__` — flowed straight into the typed output). The shape
    predicate and the parser fast path refuse inputs with undeclared keys so
    extras cannot survive via `{ ...input }`. The declared-keys Set is hoisted
    to module scope and the sweep is an allocation-free `for...in` loop.

  Schemas without `additionalProperties: false` generate byte-identical output
  to before, so loose parsing keeps its existing fast path. Schemas combining
  `additionalProperties: false` with `patternProperties` or composition keywords
  skip the undeclared-key handling, since the generator cannot evaluate those
  yet. The `strict` option docs and config schemas no longer claim unknown keys
  are always allowed.

### Patch Changes

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.7.2

### Patch Changes

- 51c2032: Close package gaps and add performance improvements.

  - **resolve-refs:** the SSRF guard now follows redirects manually and re-checks
    every hop (an allow-listed host can no longer bounce to a private/metadata
    address), and detects IPv4-mapped IPv6 and decimal/octal/hex IPv4 encodings.
    Concurrent loads of the same remote URL are coalesced onto one request.
  - **runtime-validators:** adds `unevaluatedProperties` / `unevaluatedItems`
    (annotation tracking across `$ref`/`allOf`/`if`-`then`-`else`/`anyOf`/`oneOf`/
    `dependentSchemas`, matching Ajv), and a linear `uniqueItems` fast-path for
    all-primitive arrays.
  - **generate-validators:** validates `const`, `dependentRequired`, and
    `propertyNames` (pattern form); regex `pattern`s are now correctly escaped so
    patterns containing `/` (or backslashes) emit compiling literals.
  - **generate-parsers:** corrects regex `pattern` escaping (backslashes are no
    longer doubled, which previously turned `\d` into a literal backslash) via the
    shared `@amritk/helpers/escape-regex-pattern`.
  - **helpers:** new `escape-regex-pattern` export and `hasDependentRequired` /
    `hasPropertyNames` guards; `resolveDynamicRefs` now rewrites `$dynamicRef`s
    nested inside array keywords (`allOf`, `anyOf`, `oneOf`, `prefixItems`).
  - **cli:** invalid `--input` / `--helpers` values fail fast with a clear message
    instead of being silently dropped, and `tsc` build failures include the
    compiler output.
  - **adapters:** the Zod and Valibot adapters now report when an unrepresentable
    type is widened to "accept anything" instead of dropping it silently.

- Updated dependencies [51c2032]
  - @amritk/helpers@0.8.0

## 0.7.1

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/generate-markdown@0.2.4
  - @amritk/helpers@0.7.1

## 0.7.0

### Minor Changes

- 6fdb8bf: Consolidate the `$ref`-graph traversal that the parser, validator, and example
  generators each re-implemented into a single shared `@amritk/helpers/walk-ref-graph`
  walker (plus `@amritk/helpers/generate-index-barrel` and
  `@amritk/helpers/extract-dynamic-anchor-defs`). The walker resolves the ref
  once and rewrites `$dynamicRef` → `$ref` in one place, and memoizes the
  draft-07 upgrade, dynamic-ref map, and each `resolveRef` / `extractRefs` per
  root document so running several generators over the same loaded schema does
  the expensive walking once.

  The validator and example generators now also seed `$dynamicAnchor`-only
  definitions (the parser generator already did), so a definition reachable only
  through `$dynamicRef` always gets its own generated file instead of being
  referenced without one.

### Patch Changes

- Updated dependencies [6fdb8bf]
  - @amritk/helpers@0.7.0

## 0.6.3

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/generate-markdown@0.2.3
  - @amritk/helpers@0.6.2

## 0.6.2

### Patch Changes

- Updated dependencies [f9c426a]
  - @amritk/generate-markdown@0.2.2

## 0.6.1

### Patch Changes

- Updated dependencies [ccecc67]
  - @amritk/helpers@0.6.1

## 0.6.0

### Minor Changes

- 9fea346: Make the generated type-name suffix configurable and default it to no suffix.

  `refToName` previously always appended `Object` to every type name derived from
  a `$ref` (e.g. `Contact` → `ContactObject`). It now accepts an optional `suffix`
  that defaults to `''`, so generated types, parsers, and validators use the plain
  PascalCase name by default.

  A new `typeSuffix` option threads through the generators and the CLI
  (`--type-suffix <suffix>`) to restore or customize the suffix — pass
  `--type-suffix Object` to keep the previous `ContactObject` naming.

  **Breaking:** with no `typeSuffix` set, generated type/parser/validator names no
  longer include the `Object` suffix. Set `typeSuffix: 'Object'` (or
  `--type-suffix Object`) to preserve the old output.

### Patch Changes

- Updated dependencies [9fea346]
  - @amritk/helpers@0.6.0

## 0.5.0

### Minor Changes

- 99f1876: Add an `--out-file` option that concatenates every generated definition into a single self-contained file instead of a directory (currently supported with `--types-only`). Add a `--readonly` option that emits every property, array, and record in the generated types as `readonly` for deeply immutable types. All CLI flags now accept both kebab-case and camelCase (e.g. `--out-dir` and `--outDir`) and are documented as kebab-case. `buildSchema` gains an optional trailing `readonly` argument, and `generateTypeDefinition` gains an optional `options` argument.
- 9a26ac1: Add `--schemaDir` for recursive generation: point mjst at a directory of JSON Schemas and it generates parsers for every `*.json` file, mirroring the directory layout under `outDir`. The runtime helpers are emitted once into a shared `outDir/_helpers/` that every nested parser imports from (via a computed relative path), and `--build` compiles the whole tree in place. `buildSchema` gains an optional `helpersImportPrefix` argument to support the shared-helpers layout.

### Patch Changes

- Updated dependencies [99f1876]
  - @amritk/helpers@0.5.0

## 0.4.0

### Minor Changes

- d5da63a: Add schema adapters so the CLI can ingest schemas from external libraries. The
  new `@amritk/adapters` package converts a source schema into Draft 2020-12 JSON
  Schema before generation, leaving the core pipeline untouched. The CLI gains
  `--input <format>` — `typebox`, `zod`, `valibot`, and `effect`, alongside the
  default `json` — and `--export <name>` to pick which export of a schema module
  to use.

  Each source library is an optional peer dependency loaded at runtime. The Zod
  (Zod 4 `toJSONSchema`) and Valibot (`@valibot/to-json-schema`) adapters map
  their date types to the same `x-mjst` instanceOf extension used by TypeBox
  dates; the Effect adapter (`JSONSchema.make`) passes through Effect's encoded
  representation. Constructs JSON Schema cannot express are preserved via the
  `x-mjst` extension, which the type generator, parsers, and validators
  understand.

  Constructs that JSON Schema cannot express (e.g. TypeBox's `Type.Date()`) are
  preserved via an `x-mjst` vendor extension. The type generator, parsers, and
  validators now understand `x-mjst: { instanceOf }`, emitting the class type, an
  `instanceof` check (with `Date` coercion in non-strict parsers), and a matching
  validator error.

### Patch Changes

- Updated dependencies [d5da63a]
  - @amritk/helpers@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [83eb57a]
  - @amritk/helpers@0.3.0

## 0.3.0

### Minor Changes

- cbc0e4c: Generated parser output is now self-contained when `@amritk/helpers` isn't installed in the consumer project.

  - `@amritk/mjst` (CLI) auto-detects whether `@amritk/helpers` resolves from the consumer's `outDir`. When it doesn't, the CLI runs in **embedded** mode: the runtime helper sources are shipped alongside the generated parsers in `outDir/_helpers/` and imports are rewritten to `./_helpers/...`. When it does, the CLI runs in **package** mode (the historical behaviour) and continues to import from `@amritk/helpers/...`.
  - New `--helpers <package|embedded>` CLI flag (and config key) lets callers override auto-detection — useful for forcing self-contained output in CI or when shipping generated code to a runtime without `@amritk/helpers` installed.
  - `@amritk/generate-parsers`' `buildSchema()` takes a new optional `helpersMode` parameter; in embedded mode it appends `_helpers/<name>.ts` entries to its returned `GeneratedFile[]` for each runtime helper the generated parsers actually use.
  - The CLI's `--build` flag no longer relies on a brittle `compilerOptions.paths` mapping that pointed back into the CLI's own install location; in both modes, `tsc` now resolves helper imports via standard module resolution.
  - `@amritk/helpers` extracts `hasRef` into its own subpath export (`@amritk/helpers/has-ref`). The existing `@amritk/helpers/schema-guards` continues to re-export it for backward compatibility.

### Patch Changes

- Updated dependencies [cbc0e4c]
  - @amritk/helpers@0.2.2

## 0.2.1

### Patch Changes

- dbf49bf: Republish via npm trusted publishing (OIDC).
- Updated dependencies [dbf49bf]
  - @amritk/generate-markdown@0.2.1
  - @amritk/helpers@0.2.1

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.
- b6e63c3: Add `strict` option that makes generated parsers throw on invalid input instead of coercing to defaults. Available as the `--strict` CLI flag, the `strict` key in `mjst.config.json`, and the `strict` argument on `buildSchema` / `generateFile` / `generateParserFunction`. Throws on non-object input, missing required properties, wrong primitive types, and enum / pattern / length / min / max / multipleOf violations. Unknown extra keys are still allowed.

### Patch Changes

- ad1efe5: chore: initial release
- Updated dependencies [ad1efe5]
- Updated dependencies [53fa6bf]
  - @amritk/generate-markdown@0.2.0
  - @amritk/helpers@0.2.0
