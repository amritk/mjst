# @amritk/helpers

## 0.15.0

### Minor Changes

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

## 0.14.0

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

## 0.13.5

### Patch Changes

- 217cb66: `FromSchema` now honours the `x-mjst` `brand` hint, so branded ids reach the API
  boundary.

  - **`@amritk/runtime-validators`** — a schema carrying
    `'x-mjst': { brand: 'UserId' }` now infers `Base & { readonly __brand: 'UserId' }`
    (e.g. `string & …`), matching the `.d.ts` shape the code generators already
    emit. Branding stays type-level only — runtime validation still checks the
    plain base type — and `null` remains assignable when a `nullable` schema is
    branded.
  - **`@amritk/api`** — because route `params` / `query` / `body` are typed through
    `FromSchema`, a branded param schema now flows a nominal id into the handler and
    the derived typed client, so a `UserId` can't be passed where an `OrderId` is
    expected. The same protection Drizzle's `.$type<UserId>()` gives a column, at
    the API boundary.
  - **Docs** — the `x-mjst` reference now documents the `brand` hint (a new
    "Nominal brands" section in `@amritk/adapters`), with recipes in the
    `@amritk/api` README/AI.md and the `@amritk/runtime-validators` type-inference
    docs, plus the `mjst-extension` subpath in `@amritk/helpers`.

## 0.13.4

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.

## 0.13.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.

## 0.13.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).

## 0.13.1

### Patch Changes

- 797a156: Fix a batch of correctness bugs found in a cross-package audit:

  - **`@amritk/lint`**: the `alphabetical` rule compared decimal numeric strings lexically because of an inverted numeric guard, flagging correctly-ordered lists like `["9.5", "10"]` and missing genuinely out-of-order ones. Numeric strings now compare numerically on both sides.
  - **`@amritk/mjst`** (CLI): the `validators` key in a JSON config file was silently ignored, so `validators: true` in a config never emitted `validateX`/`isX` files. It is now read like every other boolean flag.
  - **`@amritk/runtime-validators`**:
    - `minContains: 0` together with `maxContains` no longer wrongly rejects arrays under `unevaluatedItems` (it now marks the array evaluated, matching Ajv).
    - the `ipv6` format now accepts IPv4-mapped / IPv4-embedded addresses (e.g. `::ffff:192.168.0.1`), rebuilt from the RFC 4291 grammar.
    - local `$ref` fragments are percent-decoded per RFC 6901 §6, so a ref like `#/$defs/a%20b` resolves to the key `a b` instead of throwing.
  - **`@amritk/helpers`**: `escapeRegexPattern('')` now emits `(?:)` instead of an empty body, so a schema `pattern: ""` no longer generates `//.test(...)` (a comment) that breaks the generated file. This also fixes the empty-pattern case in generated parsers and validators.
  - **`@amritk/generate-examples`**: integer arbitraries now round fractional bounds (`minimum: 2.5`, `exclusiveMinimum: 5.5`) to satisfiable integers instead of handing `fc.integer` a non-integral bound that throws at sample time; number arbitraries honour the tighter of an inclusive/exclusive bound pair instead of dropping the exclusive one.
  - **`@amritk/generate-validators`**: schema-controlled property names are now escaped when embedded in generated error-path template literals, so a key containing a backtick or `${…}` can no longer break compilation or inject an interpolation; paths also JSON-Pointer-escape `~` and `/` to match the interpreter.
  - **`@amritk/adapters`**: the Valibot adapter now targets Draft 2020-12, so tuples emit `prefixItems` (validated downstream) instead of draft-07 `items: [...]` (silently under-validated).

## 0.13.0

### Minor Changes

- 9bf3330: feat: honour previously-ignored schema constraints so generated examples and
  arbitraries validate against their own schema. Both codepaths now implement
  `patternProperties`, `propertyNames`, `dependentRequired`, `dependentSchemas`,
  `minProperties`, `maxProperties`, and `contains` (the arbitrary path previously
  skipped `minProperties`/`contains`), and filter `enum` members by their sibling
  length/range/pattern constraints. `if`/`then`/`else`, `not`, and `oneOf`
  exclusivity — which no structural generator captures — are reconciled by a
  post-generation validating filter built with `@amritk/runtime-validators`:
  `deriveExample` re-derives and rejects candidates until one validates, and the
  generated arbitrary appends a `.filter(...)` backed by a runtime validator (that
  file then imports `@amritk/runtime-validators`; files that need no filter don't).
  `@amritk/helpers` gains `hasPatternProperties`, `hasDependentSchemas`,
  `hasContains`, `hasNot`, and `hasIf` schema guards.
- e612130: `buildDynamicRefMap` and `extractDynamicAnchorDefs` now scan the whole schema
  document instead of only direct `$defs` entries, so a `$dynamicAnchor` declared
  anywhere in the tree gets its `$dynamicRef`s rewritten and its target file
  generated. Previously those bindings were silently lost. Anchor names map to
  the JSON Pointer of the declaring subschema (first occurrence wins); a
  `$dynamicAnchor` on the document root itself is still skipped, since a
  `$ref: "#"` self-reference has no generatable output file.

## 0.12.0

### Minor Changes

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

## 0.11.0

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

## 0.10.3

### Patch Changes

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

## 0.10.2

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

## 0.10.1

### Patch Changes

- 7d43e6f: Render multi-line schema descriptions as proper JSDoc blocks in generated
  types. Each line now gets an asterisk prefix and multi-line property comments
  expand onto their own lines, instead of leaving continuation lines unprefixed.

## 0.10.0

### Minor Changes

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

## 0.9.0

### Minor Changes

- b0c83e7: Fix several correctness issues surfaced by a code review:

  - **yaml**: negative hexadecimal and octal scalars (`-0x10`, `-0o10`) no longer
    have their sign double-applied and flipped positive; out-of-range or malformed
    `\x`/`\u`/`\U` escapes in double-quoted scalars are now treated as literal text
    instead of throwing a `RangeError` (via `String.fromCodePoint`) or silently
    dropping the following characters.
  - **resolve-refs**: `pointerToPath` only coerces canonical RFC 6901 array-index
    tokens to numbers, so a numeric object key with a leading zero such as `"01"`
    is kept as a string rather than aliased to a different key. The shared
    JSON Pointer segment decode is now factored into one helper.
  - **generate-validators**: object/array `const` checks compare with a new
    order-independent `valuesEqual` runtime helper instead of `JSON.stringify`, so
    a reordered-but-equal value matches (in step with the interpreter);
    `propertyNames` now validates every key against the full subschema (length,
    enum, const, `$ref`), not just the `pattern` form; and the draft-04 boolean
    `exclusiveMinimum`/`exclusiveMaximum` form is honored.
  - **helpers**: add `hasStrictExclusiveMinimum` / `hasStrictExclusiveMaximum`
    guards for the draft-04 boolean exclusive-bound form.

## 0.8.0

### Minor Changes

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

## 0.7.1

### Patch Changes

- 6218978: chore: version bumps

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

## 0.6.2

### Patch Changes

- 8cde234: Re-publish all packages.

## 0.6.1

### Patch Changes

- ccecc67: Fix JSDoc comment emission in generated type definitions.

  - Emit `/** description */` comments for properties inside `allOf` inline object schemas (previously they were silently dropped).
  - Emit `description` as a top-level JSDoc comment when a `$ref` is factored out, matching the existing `$comment` behaviour (`description` takes precedence when both are present).

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

## 0.5.0

### Minor Changes

- 99f1876: Add an `--out-file` option that concatenates every generated definition into a single self-contained file instead of a directory (currently supported with `--types-only`). Add a `--readonly` option that emits every property, array, and record in the generated types as `readonly` for deeply immutable types. All CLI flags now accept both kebab-case and camelCase (e.g. `--out-dir` and `--outDir`) and are documented as kebab-case. `buildSchema` gains an optional trailing `readonly` argument, and `generateTypeDefinition` gains an optional `options` argument.

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

## 0.3.0

### Minor Changes

- 83eb57a: Derive the root type name from the schema's `title` instead of always using "Document". The CLI now generates types and parsers named after the schema (e.g. an "OpenAPI Document" title yields `OpenAPIDocument` / `parseOpenAPIDocument`), falling back to `Document` when the schema has no usable title. Adds a `deriveRootTypeName` helper to `@amritk/helpers`.

## 0.2.2

### Patch Changes

- cbc0e4c: Generated parser output is now self-contained when `@amritk/helpers` isn't installed in the consumer project.

  - `@amritk/mjst` (CLI) auto-detects whether `@amritk/helpers` resolves from the consumer's `outDir`. When it doesn't, the CLI runs in **embedded** mode: the runtime helper sources are shipped alongside the generated parsers in `outDir/_helpers/` and imports are rewritten to `./_helpers/...`. When it does, the CLI runs in **package** mode (the historical behaviour) and continues to import from `@amritk/helpers/...`.
  - New `--helpers <package|embedded>` CLI flag (and config key) lets callers override auto-detection — useful for forcing self-contained output in CI or when shipping generated code to a runtime without `@amritk/helpers` installed.
  - `@amritk/generate-parsers`' `buildSchema()` takes a new optional `helpersMode` parameter; in embedded mode it appends `_helpers/<name>.ts` entries to its returned `GeneratedFile[]` for each runtime helper the generated parsers actually use.
  - The CLI's `--build` flag no longer relies on a brittle `compilerOptions.paths` mapping that pointed back into the CLI's own install location; in both modes, `tsc` now resolves helper imports via standard module resolution.
  - `@amritk/helpers` extracts `hasRef` into its own subpath export (`@amritk/helpers/has-ref`). The existing `@amritk/helpers/schema-guards` continues to re-export it for backward compatibility.

## 0.2.1

### Patch Changes

- dbf49bf: Republish via npm trusted publishing (OIDC).

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.

### Patch Changes

- ad1efe5: chore: initial release
