# @amritk/generate-examples

## 0.6.2

### Patch Changes

- Updated dependencies [2e3399a]
  - @amritk/helpers@0.15.2
  - @amritk/runtime-validators@0.10.1

## 0.6.1

### Patch Changes

- 4178e8d: Patch release across all packages.
- Updated dependencies [4178e8d]
  - @amritk/helpers@0.15.1
  - @amritk/runtime-validators@0.10.1

## 0.6.0

### Minor Changes

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

### Patch Changes

- d989bc4: Make generation linear in the `$ref` graph, and stop shipping examples that fail their own schema

  **A `$ref` reachable by several paths is derived once, not once per path.**
  `deriveExample` tracked visited refs in a _path-scoped_ set with no memo table,
  so every fan-out in the definition graph re-expanded the same subtree
  exponentially: a 25-definition graph with three refs per definition took ~20
  seconds, and adding two more definitions roughly quadrupled that. Derivation is
  now memoized per ref per root document — the pattern
  `@amritk/helpers/walk-ref-graph` already uses for `resolveRef` — with the cycle
  guard kept exact: a value produced by cutting a cycle is deliberately not
  memoized, so a recursive definition still terminates at the same place. The same
  graph at 400 definitions now derives in ~7 ms.

  **A validating check no longer carries the whole document.** Every check spliced
  the root's entire `$defs` into the schema it validated, and the interpreter
  screens each `pattern` in whatever it is handed — so a 959-definition OpenAPI
  document paid for all 959 definitions on each of the thousand-odd checks a
  generation run makes, and embedded the whole document into every generated file
  carrying a validating filter. Only the definitions a schema's `$ref`s actually
  reach travel with it now (a reference that cannot be pinned to one definition —
  an `$anchor` name, or a `$dynamicRef`/`$recursiveRef`, whose target is picked
  from the dynamic scope at validation time — still falls back to the full set).
  Generating the OpenAI corpus went
  from ~3.6 s to ~0.3 s, and its generated output from 119 MB to 2.7 MB.

  **Generated arbitraries compile under a strict tsconfig.** `fc.constantFrom("a",
"b")` infers `Arbitrary<string>`, which does not fit the `"a" | "b"` the
  generated type declares — so _any_ schema with an `enum` property produced a
  file no consumer on `strict` could build. Scalar members are now spread from a
  `const`-asserted tuple, and a filtered arbitrary's predicate is written as a
  type guard (`(value): value is Foo => …`), which is what it has always been: the
  combinators generate a superset and the runtime validator narrows it. A new
  suite type-checks generated files against the real `fast-check` declarations
  under `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.

  **An example that fails its own schema is now reported instead of shipped
  quietly.** Every `fooExample` is validated (formats included) before it is
  written; a value that does not satisfy the schema is still emitted, so the
  module compiles, but the generator warns and names the type. Several cases that
  used to fail silently now produce valid values: `not` gets a perturbation
  candidate (`not: { const: 'string' }` no longer returns `"string"`),
  `uniqueItems` over a closed value set walks the set instead of suffixing a
  string out of its own `enum`, `pattern` sampling honours `minLength` and reads
  control escapes (`a\nb` produced `"anb"`), and static examples now cover every
  `format` `@amritk/runtime-validators` checks — `duration`, `json-pointer`,
  `relative-json-pointer`, `uri-template`, `uri-reference`, `regex`, and the `idn-`
  /`iri` variants. A key that `additionalProperties: false` forbids is no longer
  invented. The remaining limits are written down in the README.

  **A `__proto__` property survives.** Both the derived value (`out[key] = …` hit
  `Object.prototype`'s prototype setter, so the key vanished) and the emitted
  source (a _quoted_ `"__proto__":` in an object literal is still the setter, in
  the example value and in the `fc.record` config — where it also reassigned the
  config object's prototype to an `Arbitrary`). The value uses `defineProperty`
  and the source uses the computed `["__proto__"]:` form, matching what
  `generate-parsers` already does.

  **A schema the validator refuses no longer kills the run — and no longer goes
  unmentioned.** A `$ref` pointing outside the document (`#/components/schemas/…`
  in a bare fragment) threw out of `buildExampleSchema`. Those checks are opinions
  about a candidate value, so an undecidable schema now abstains. It also warns
  once, naming the schema and the reason, because a filter that switches itself
  off silently is indistinguishable from one that ran and approved of everything.

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

- Updated dependencies [213ecc4]
- Updated dependencies [9cb45a0]
- Updated dependencies [5afbfd4]
- Updated dependencies [eb80ca6]
- Updated dependencies [798fd7a]
- Updated dependencies [2c9982c]
- Updated dependencies [f439570]
- Updated dependencies [fa8620c]
- Updated dependencies [bc09e15]
- Updated dependencies [b152c4e]
- Updated dependencies [15e480e]
- Updated dependencies [140412b]
  - @amritk/helpers@0.15.0
  - @amritk/runtime-validators@0.10.0

## 0.5.6

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

- Updated dependencies [65771d4]
- Updated dependencies [fe8191b]
  - @amritk/runtime-validators@0.9.1
  - @amritk/helpers@0.14.0

## 0.5.5

### Patch Changes

- Updated dependencies [217cb66]
  - @amritk/runtime-validators@0.9.0
  - @amritk/helpers@0.13.5

## 0.5.4

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
- Updated dependencies [b4cd20a]
  - @amritk/runtime-validators@0.8.0
  - @amritk/helpers@0.13.4

## 0.5.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/helpers@0.13.3
  - @amritk/runtime-validators@0.7.3

## 0.5.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
- Updated dependencies [4e23c02]
  - @amritk/helpers@0.13.2
  - @amritk/runtime-validators@0.7.2

## 0.5.1

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

- Updated dependencies [797a156]
  - @amritk/runtime-validators@0.7.1
  - @amritk/helpers@0.13.1

## 0.5.0

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

### Patch Changes

- a6f4606: Collect `$ref` imports from the full schema surface the generators traverse.

  `collectExampleImports` only harvested `$ref`s from top-level
  `properties`/`items`/`additionalProperties` and top-level combinator branches,
  but `arbitraryExpr` (and the type generator) recurse deeper — into tuple
  `prefixItems`, array-form `items`, `patternProperties`, and combinators nested
  under a property. A `$ref` hidden in any of those emitted a bare `XxxArbitrary`
  identifier (or a bare `Xxx` type) with no matching import, producing an example
  file that failed to compile. Import collection now recurses over that same
  surface via a single ref-walking helper, so every referenced ref is imported.

- 9c98116: Emit lazy references for cross-file `$ref` cycles so mutually recursive schemas
  no longer crash on import.

  Previously only direct self-references were tied lazily (via `fc.letrec`). A
  mutual cycle spanning files (`a → b → a`) emitted eager top-level references
  between the generated modules, which threw a circular-ESM TDZ `ReferenceError`
  the moment the arbitraries were imported. The builder now detects strongly
  connected components in the ref graph and defers references between cycle
  members (`fc.constant(null).chain(() => OtherArbitrary)`), breaking the import
  cycle while leaving non-cycle references eager.

- 7b37ec2: fix(generate-examples): construct `type: number` + `multipleOf` arbitraries
  analytically instead of filtering random doubles. The old
  `fc.double(...).filter((n) => n % m === 0)` almost never passed, so fast-check
  threw "too many filtered values" at sample time. The arbitrary now draws an
  integer `k` and emits `k * multipleOf`, honouring `exclusiveMinimum` /
  `exclusiveMaximum` and clamping back into bounds to absorb floating-point drift.
- Updated dependencies [9bf3330]
- Updated dependencies [e612130]
- Updated dependencies [74498a7]
- Updated dependencies [175e4f0]
  - @amritk/helpers@0.13.0
  - @amritk/runtime-validators@0.7.0

## 0.4.5

### Patch Changes

- Updated dependencies [1bb7a25]
  - @amritk/helpers@0.12.0

## 0.4.4

### Patch Changes

- Updated dependencies [91dab2b]
- Updated dependencies [9253843]
  - @amritk/helpers@0.11.0

## 0.4.3

### Patch Changes

- Updated dependencies [02f6b05]
  - @amritk/helpers@0.10.3

## 0.4.2

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

- 4501ff0: Robustness fixes across the CLI and peripheral generators:

  - **generate-examples**: recursive schemas now emit lazily-tied fast-check
    arbitraries (`fc.letrec`) instead of code that crashed with a TDZ
    `ReferenceError`; `pattern`s are escaped so a `/` no longer breaks the emitted
    regex literal, and `minLength`/`maxLength` are honored alongside a pattern;
    tuples, `allOf`, `additionalProperties`, and combined `minimum`+`exclusiveMinimum`
    bounds are handled.
  - **cli**: config files no longer silently drop the `helpers`/`typeSuffix`/`banner`
    keys; unknown or value-missing flags now error instead of being ignored; schema
    discovery skips `node_modules` and dot-directories; a missing `npx`/`tsc` is
    distinguished from a real compile failure.
  - **generate-markdown**: `x-icon` is HTML-escaped, and a README missing its
    markers is no longer clobbered with a table-only file.
  - **exports** maps now order the `types` condition before `default` so type
    resolution works.

- Updated dependencies [1efd6e8]
- Updated dependencies [c288a90]
  - @amritk/helpers@0.10.2

## 0.4.1

### Patch Changes

- Updated dependencies [7d43e6f]
  - @amritk/helpers@0.10.1

## 0.4.0

### Minor Changes

- 1b09827: Derive example values that actually satisfy more of their schema. `deriveExample`
  previously ignored many constraints and emitted values that fail their own
  schema; a new Ajv differential test now guards against that. It now honors:

  - numeric `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, and `multipleOf`
    (not just `minimum`), picking a value inside the bounds.
  - array `maxItems` (the count is clamped into `[minItems, maxItems]`, so
    `maxItems: 0` yields `[]`) and tuple schemas (`prefixItems`, and the draft-07
    array-form `items`), deriving one value per position.
  - object `required` keys that have no `properties` entry (filled from
    `additionalProperties` when it is a schema, else `null`).
  - `allOf`, by merging the branches (properties combined, `required` unioned,
    numeric/length bounds tightened) instead of returning `null`.
  - `enum` (and `const`) members alongside a length/range constraint — the first
    member that also satisfies it is chosen rather than blindly the first.
  - `minProperties` (filler keys are synthesized when extras are allowed),
    `uniqueItems` (primitive items are perturbed to stay distinct), `contains` /
    `minContains` (enough items satisfy the contained schema), and `pattern` via a
    best-effort regex sampler that does a small recursive descent over the pattern
    — anchors, character classes, `\d`/`\w`/`\s`, groups (capturing /
    non-capturing / named), alternation (`a|b`), and quantifiers — verified against
    the real regex before use.

  Lookarounds, backreferences, and otherwise unsatisfiable schemas remain
  best-effort; use the generated `fast-check` arbitrary when full fidelity is
  required.

## 0.3.2

### Patch Changes

- Updated dependencies [cdfe681]
  - @amritk/helpers@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.3.0

### Minor Changes

- 4431f2d: Generate dedicated fast-check arbitraries and concrete examples for more string
  formats (`time`, `hostname`, `ipv4`, `ipv6`) and for multi-type schemas such as
  `type: ['string', 'null']`, instead of degrading them to `fc.anything()` / `null`.

## 0.2.2

### Patch Changes

- Updated dependencies [51c2032]
  - @amritk/helpers@0.8.0

## 0.2.1

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/helpers@0.7.1

## 0.2.0

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

## 0.1.1

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/helpers@0.6.2

## 0.1.0

### Minor Changes

- 7e2b40a: Add `@amritk/generate-examples`: a generator that turns a JSON Schema into test
  data. For each schema node it emits a `fast-check` arbitrary (`FooArbitrary`)
  for property-based testing and a concrete, self-contained example value
  (`fooExample`) for fixtures, seeds, and docs, alongside the matching type
  definition. `fast-check` is an optional peer dependency used only by the
  generated arbitraries.
