# @amritk/lint

## 0.4.6

### Patch Changes

- Updated dependencies [eb4e216]
  - @amritk/yaml@0.7.0

## 0.4.5

### Patch Changes

- Updated dependencies [7d2c805]
- Updated dependencies [05d0b29]
- Updated dependencies [a6bd637]
  - @amritk/yaml@0.6.0

## 0.4.4

### Patch Changes

- 874856f: Stop rulesets from executing code, and close two document-driven hangs

  **A `[?(...)]` filter in a `given` is no longer JavaScript.** Filter bodies were
  handed straight to `new Function`, so a `given` string in a YAML or JSON ruleset
  — data, to any caller's eye — ran arbitrary code in the linting process:
  `$[?(globalThis.x = {home: process.env.HOME})]` leaked the environment,
  `import('node:fs')` wrote files. Filters are now parsed into a small AST and
  interpreted (`@`, `@.x`, `@['x']`, `@property`, `@parentProperty`, `@parent`,
  `@path`, `@root`, `$`, the comparison and logical operators, `!`, numeric
  negation, string/number/boolean/null/`undefined`/`void 0` literals, regex
  literals, `.length`, and a fixed list of pure methods — `indexOf`,
  `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `match`, `test`,
  `toLowerCase`, `toUpperCase`, `trim`). Member reads see own properties only, so
  `@.constructor` and `@['__proto__']` are plain `undefined`. Verified
  node-for-node identical to the old evaluator on the shipped `oas` filters across
  every vendored real-world spec. An expression outside the grammar is now a
  ruleset error naming the rule, instead of a filter that silently matches
  nothing — which also fixes filters quietly disabling themselves wherever
  `new Function` is unavailable (CSP, Workers).

  **The `casing` function no longer hangs on a long identifier.** `camel`/`pascal`
  compiled to a pattern where digits could be consumed two ways, so a value from
  the linted document could force exponential backtracking: a 46-character
  `operationId` took over 100 seconds on Node (Bun's regex engine caps
  backtracking, which hid it). The patterns are rewritten to be unambiguous, and
  verified by brute force to accept exactly the same strings as before. Same for
  the second overlap, a separator character the style already uses (`kebab` with
  `separator: '-'`), which was exponential from ~40 characters.

  **A deeply nested document is a diagnostic, not a crash.** `'['.repeat(20000)` —
  a 40 KB file — took the process down with `RangeError: Maximum call stack size
exceeded`, while every other malformed document came back as findings. JSON
  parsing now enforces the same 1000-level nesting limit `@amritk/yaml` does and
  reports it as a parser diagnostic, and the JSONPath descent walker is iterative.

  **Rulesets are built once, not per document.** `lintDocument` re-normalized the
  ruleset and re-read every `extends` file on every call (~3.6 ms per document
  with a 200-rule `extends` file; `fixDocument` paid it up to 11× per document).
  The built `Ruleset` is memoized per `(definition object, basePath, restrictTo)`,
  and `fixDocument` builds one for the whole loop — 200 lints of a small document
  went from 750 ms to ~120 ms — so editing a ruleset file mid-run also stops
  changing results half way through. Treat a definition you have passed in as
  frozen; pass a fresh object to force a rebuild.

  **`@amritk/lint/rules/openapi` can be bundled.** The four OpenAPI meta-schemas
  were loaded through `createRequire` with a computed specifier, invisible to
  bundlers (esbuild produced a 524-byte module that threw `Cannot find module
'./oas31.json'`) and unavailable on Workers and Deno. They are now generated
  `.ts` modules imported statically, each holding its schema as JSON text that is
  still parsed lazily on first use.

  **`fixDocument` reports whether it converged.** The result gains `converged` and
  `passes`, and `applied` is de-duplicated by rule code and path: two fixers that
  undo each other used to report 11 applied fixes for one problem with no way to
  tell a fixpoint from giving up at the pass cap.

  **Also:** `alphabetical` no longer treats `'0x10'`, `'1e2'`, or `' 5'` as
  numbers (they were flagged out of order though lexicographically sorted); the
  module-level JSONPath, filter, and pattern caches are bounded; `extends` and
  custom-function resolution accept an optional `restrictTo` root; and the ruleset
  trust boundary is documented in the README and AI.md.

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

- 00eb0c9: Read tabs by the column they sit at, hold a flow collection to its parent's
  indentation, and pin JSON as the superset it is

  YAML 1.2 test suite conformance goes from **384/402 (95.5%) to 398/402 (99.0%)**.
  What is left is four cases where the right answer is not the suite's — one
  duplicate-key case that turns on the `uniqueKeys` default, and three tags that
  project to a `Uint8Array`/`Set`/`Map` — so this closes the boundary rather than
  moving it. Parse throughput is unchanged: an order-balanced A/B over the bench
  fixtures lands every case inside run-to-run noise (medians −3% to +1.6% against a
  4–6% CV, with min-of-runs favouring the new code).

  **A tab is only an error where indentation belongs.** Indentation in YAML is
  spaces (`s-indent ::= s-space × n`), but a tab _past_ the indentation is ordinary
  separation — and the two are told apart only by the column the tab sits at.
  `peekLine` reported any leading tab at all, which cut both ways: it rejected three
  valid documents (`\t[…]` and `\t{}` at the document root, and a `foo:` whose value
  line reads `⟨space⟩⟨tab⟩bar`) while missing the tabs that really are indentation.
  Every caller knows the column its line owes, so it now passes it in, and the same
  rule is applied in the three other places a tab can stand for indentation:

  - Inside a block scalar — `foo: |` over a lone `\t` is reported, where the same
    line written ` \t` is valid content and still parses to `"\t\n"`.
  - In the separation between a block indicator and a **compact collection** opened
    on its line. A compact collection takes its indentation from the column it lands
    on, so `-\t-`, `?\tkey:` and `:\t- x` are invalid — while `-\tfoo` and `-\t-1`
    are ordinary separation and stay valid.
  - In a flow collection's continuation lines (below).

  **A flow collection is held to the indentation of the block that holds it.** Flow
  scanning is delimiter-driven, so `flow: [a,` over a column-0 `b,` read exactly
  like a properly indented collection and parsed clean; it is now reported once per
  collection as `BAD_INDENT`. Indentation is counted in spaces, which folds the tab
  rule in for free. The closing `]`/`}` is deliberately held one column looser than
  the spec asks — to the parent's own column rather than one past it — because
  closing a multi-line flow collection at the parent's column is how Prettier and
  hand-written manifests both write it, and `yaml` and `js-yaml` both accept it.

  **A tag or anchor inside a flow collection ends at the flow indicator.** In
  `{ foo : !!str, }` the tag token swallowed the comma, which the tag-character check
  then reported while the missing comma left the mapping looking unterminated and
  shifted every entry after it. Outside a flow collection those characters are still
  ordinary tag content, so a block-context `!!str,` is still a `BAD_TAG`.

  **Tab-indented JSON parsed to the wrong value.** A wrapped flow line's leading
  whitespace is `s-indent(n) s-separate-in-line?`, so tabs sit in it as spaces do —
  but the flow scalar scanner skipped only spaces, so the `]` closing a tab-indented
  line was never seen as the flow indicator it is and the line folded into the scalar
  instead. `JSON.stringify(value, null, '\t')` — what `jq --tab` and every
  "indent with tabs" editor setting emit — therefore turned the last entry before a
  `]` into a string with a trailing newline: `-1` came back as `"-1\n"`.

  **The 1024-character implicit key limit is enforced in block context.** YAML caps
  how far past a key's start its `:` may sit so a processor can recognize a mapping
  entry with bounded lookahead; a longer block key is now `BAD_IMPLICIT_KEY`. It is
  deliberately _not_ enforced in flow context, matching `yaml` (eemeli): a flow
  mapping is where JSON lives, `{"…1100 characters…": 1}` is valid JSON, and
  rejecting a valid JSON document is the worse of the two errors. Relatedly, an
  explicit key in a flow sequence may now put its `:` on the next line
  (`[ ? a\n : b ]`) — the one-line rule exists to keep an _implicit_ key cheap to
  recognize, and a `?` settles that up front.

  **The JSON-superset property is now checked, not assumed.** `@amritk/lint` routes
  `.json` documents through the YAML parser and `resolveRefsFromFile` hands it
  whatever a `$ref` points at, so "JSON parses as YAML" is load-bearing.
  `src/json-superset.test.ts` runs a generated corpus against `JSON.parse` — every
  value in six spellings (compact, 2-space, tab-indented, CRLF, and with
  leading/trailing blank lines), requiring an identical value _and_ zero diagnostics
  for each — and `@amritk/lint` gains a matching test holding `parseJson` and
  `parseYaml` to identical data, diagnostics, and `line:column` ranges for every path
  in a JSON document.

- Updated dependencies [213ecc4]
- Updated dependencies [798fd7a]
- Updated dependencies [2c9982c]
- Updated dependencies [bc09e15]
- Updated dependencies [b152c4e]
- Updated dependencies [15e480e]
- Updated dependencies [140412b]
- Updated dependencies [7839a38]
- Updated dependencies [007aa05]
- Updated dependencies [1b720e2]
- Updated dependencies [c1a176f]
- Updated dependencies [00eb0c9]
  - @amritk/runtime-validators@0.10.0
  - @amritk/yaml@0.5.0

## 0.4.3

### Patch Changes

- e6f0ff2: Close the YAML 1.2 gaps that cost nothing on the hot path, and measure the rest
  against the official test suite.

  **Fixed — silent data loss**

  - A collection used as an implicit mapping key (`[a, b]: value`, `{a: 1}: value`)
    discarded the mapping and every sibling entry, returning only the collection.
  - An alias used as a mapping key (`*ref: value`) was keyed by the literal text
    `*ref` instead of the anchored value.
  - An anchor on an empty node (`a: &anchor`) was never registered, so a later
    `*anchor` — which is legal, and resolves to null — dangled.
  - Node properties written on their own line no longer swallow the node below
    them when it sits at the same indentation.
  - A block scalar opened on a `- ` line measured its content against the item's
    column rather than the sequence's, dropping the scalar's body.

  **Added — tag resolution**

  `!<verbatim>` tags, `%TAG` handle declarations, and the non-specific `!` now
  resolve. A local tag keeps its `!` on `node.tag` (`!custom`), so an application
  tag sharing a core tag's name no longer coerces its value like the core one.

  **Added — diagnostics**

  `UNRESOLVED_ALIAS`, `UNEXPECTED_CONTENT` (trailing content after a node, and a
  second root node with no `---`), `UNEXPECTED_COMMA` (empty flow entries),
  `BAD_SCALAR_START` (reserved `@` / `` ` ``), `BAD_TAG`, and `UNKNOWN_TAG_HANDLE`.
  Directive problems (`%YAML` version, duplicates, unknown directives) are reported
  as warnings, which populates `doc.warnings` for the first time.

  **Added — conformance harness**

  `src/conformance.test.ts` runs the official YAML test suite: **293/402 cases
  (72.9%)**, up from 251/402. Every remaining failure is listed with its reason, and
  the test fails if a case moves in either direction, so the README's scope section
  is now checked rather than asserted.

  **Behavior changes** (pre-alpha; `@amritk/lint`'s path index is updated to match)

  - `node.tag` for a local tag is now `!custom` rather than `custom`.
  - An empty mapping key projects to `''` rather than `'null'`.
  - A collection mapping key projects to its flow rendering (`'[ a, b ]'`) rather
    than `''`.

  Parser throughput is unchanged. Measured in-process against the previous parser
  across six document shapes — a tiny config, a 2 KB OpenAPI document, a 100 KB
  document, a 400-key plain block mapping, a quoted-scalar mapping, and a 200-entry
  block sequence — every shape lands within ±1% of the old parser, and the 100 KB
  document is faster. Every check added here sits in a branch that was already
  cold, reuses a character read the parser was already making, or was moved out of
  a hot function so it does not affect what the JIT inlines.

- Updated dependencies [e6f0ff2]
  - @amritk/yaml@0.4.0

## 0.4.2

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
- Updated dependencies [491bde2]
  - @amritk/runtime-validators@0.9.1
  - @amritk/yaml@0.3.5

## 0.4.1

### Patch Changes

- Updated dependencies [217cb66]
  - @amritk/runtime-validators@0.9.0

## 0.4.0

### Minor Changes

- e197c0c: **lint:** Expose the core type surface on a dedicated `@amritk/lint/types`
  subpath export and stop re-exporting those types from the main entry. Runtime
  values and the engine/plugin/ruleset types still come from `@amritk/lint`; the
  data-model types (`IDiagnostic`, `RulesetDefinition`, `JsonPath`, `ISource*`,
  `DiagnosticSeverity`, …) now import from `@amritk/lint/types`. This replaces the
  barrel `export *` re-exports with named exports sourced from a single types
  module.

  **api (docs):** The contract/client examples now use a single `contracts`
  object and named imports throughout instead of `import * as contracts` — the
  build-step example collects the individually-exported routes into a record the
  same way, so the documented usage no longer relies on namespace imports.

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
- Updated dependencies [b4cd20a]
- Updated dependencies [019ecbc]
  - @amritk/runtime-validators@0.8.0
  - @amritk/yaml@0.3.4

## 0.3.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/runtime-validators@0.7.3
  - @amritk/yaml@0.3.3

## 0.3.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
- Updated dependencies [4e23c02]
  - @amritk/runtime-validators@0.7.2
  - @amritk/yaml@0.3.2

## 0.3.1

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
- Updated dependencies [6eac298]
  - @amritk/runtime-validators@0.7.1
  - @amritk/yaml@0.3.1

## 0.3.0

### Minor Changes

- 2bf31d3: Make the built-in rule functions defensive and align them with Spectral 1.10.5:

  - `casing`: report a clear finding for an unknown `type`, accept digit-leading
    segments after a separator (e.g. `foo-2fa`), and treat a lone separator char
    as valid when `allowLeading` is set.
  - `xor`: no-op on missing/malformed `properties` instead of flagging every node.
  - `enumeration`: no-op without a `values` array and skip non-primitive input.
  - `pattern`: report an invalid regex instead of throwing, and cache compiled
    regexes.
  - `schema`: surface a clearly-invalid schema as a finding, honor `allErrors`,
    and document that the dialect is auto-detected.
  - `typedEnum`: honor `nullable` / `x-nullable` so a `null` enum entry is allowed.
  - `alphabetical`: order integer-like keys numerically, compare numeric-string
    arrays like Spectral, and emit explicit findings for non-object / non-primitive
    items under `keyedBy`.
  - `unreferencedReusableObject`: JSON-pointer-escape keys and match deep
    references so escaped and nested `$ref`s count as uses.
  - `length`: no-op with no bounds and ignore non-number bounds.
  - Add a new `or` built-in function (flags when none of the listed properties is
    present).

- ce0d515: Harden the core lint engine for Spectral compatibility and robustness. The
  runner now isolates a throwing rule function into an error diagnostic instead of
  aborting the run, reports an unknown named function once per rule, and awaits
  Spectral-style async functions (the runner's `run` is now async). Field
  targeting mirrors Spectral's `getLintTargets` (arrays are indexable, `@key`
  yields indices, a field against a primitive lints the value). Findings sort by
  source then position.

  The JSONPath engine gains array slices (`[0:2]`, `[-1:]`, `[::2]`), the
  `[(@.length-N)]` script subscript, backslash-escape handling in quoted
  segments, quote-aware `@`-token substitution, `@path` materialized as the
  jsonpath-plus string form, recursive `^`/`~` selectors, and loud parse errors
  for malformed expressions (surfaced by `createRuleset` and `validateRuleset`).

  Ruleset resolution fixes circular `extends`, resolves aliases inherited from
  extended rulesets (throwing on undefined aliases), propagates `all`/`off`
  modifiers through nested extends, throws when a shorthand targets a
  non-existing rule, falls back an invalid severity to Warning, applies
  ruleset-level `formats` per declaring ruleset, derives per-rule
  `documentationUrl`, and threads `parserOptions` from extended bases. Glob
  matching adds brace expansion, RegExp caching, and suffix matching of relative
  patterns against absolute sources. Dead `extends`/`formats` fields are removed
  from the override type.

- a0e1fbb: Surface `$ref` resolution failures as lint findings. `mjst lint` previously
  discarded the resolver's `errors` array, so a typo'd `$ref`, a missing file, or
  a refused/failed remote fetch produced no diagnostic at all. A `LintResolver`
  may now return `diagnostics`, and the CLI resolver maps each resolution error to
  a finding — anchored to the offending ref's position in the source document
  where recoverable, or reported at document level otherwise.
- acfe75e: fix(openapi): close correctness and coverage gaps in the `oas` ruleset for closer `spectral:oas` parity.

  - `oasPathParam` now evaluates path parameters per operation (path-item + operation params), adding the missing "unused definition", "required: true", and "duplicate definition" checks.
  - `oasMediaExample` is version-split so OpenAPI 2.0 response examples (a MIME-type → value map) are validated against the sibling `schema`.
  - Example/schema validation now asserts standard JSON Schema formats (matching Spectral's `ajv-formats`), validates `default`, skips `properties`/`patternProperties` maps, and never crashes on an unresolvable `$ref` in an example schema.
  - `oas3-api-servers` / `oas2-api-schemes` now report a missing (not just empty) `servers`/`schemes`.
  - `oasOpSuccessResponse` no longer counts `default` as success and accepts `2XX`/`3XX` wildcards; `oasOpParams` adds the OAS2 multiple-`in:body` check; `oasUnusedComponent` matches refs by prefix and covers `components.pathItems`; `oasServerVariables` checks default/enum; `oasOpIdUnique` is gated to real operation methods.
  - 3.2 `query` operations, webhook path-item servers, `title` markdown scanning, and anchored 3.x version detection are all handled; `nullable` detection uses a schema-aware function.
  - Fixers: `path-keys-no-trailing-slash` gains a collision guard, `duplicated-entry-in-enum` uses an order-independent dedup key, `openapi-tags-alphabetical` matches the `alphabetical` comparator, and a new `oas3_1-schema-example-deprecated` fixer migrates `example` to `examples`.

### Patch Changes

- e8d97e7: fix: repair document-corruption bugs in the parsers and auto-fix engine. JSON `setValue`/`removeProperty` on a missing path no longer create the property; removing or inserting members of compact sequence-entry maps (`- a: 1\n    b: 2`) keeps the `- ` dash and correct indentation; batched array ops (reorder + dedupe) no longer act on stale indices; plain YAML scalars are re-quoted when a bare value would change type or break the line; duplicate-key edits target the last (winning) occurrence; block-sequence comments survive reorder/remove; JSON array edits preserve original element text, Unicode, and layout; CRLF files keep CRLF on inserted lines; explicit-empty keys (`foo:`) are now editable; and the configured `duplicateKeys` severity is honored.
- 9d05033: feat: implement the `incompatibleValues` parser option. It was accepted on
  `IParserOptions` (and threaded through `parserOptions.incompatibleValues` in the
  ruleset) but `parseYaml` never read it, so callers who configured it got a silent
  no-op. The core schema projects `.nan`/`.inf`/`-.inf` to the non-finite numbers
  `NaN`, `Infinity`, and `-Infinity`, which `JSON.stringify` silently rewrites to
  `null`; each such value is now reported at the configured severity with an
  `INCOMPATIBLE_VALUE` code, its range pointing at the offending value. Detection
  is opt-in: `undefined`, `false`, and `"off"` leave it disabled.
- ef43b87: Close two precision gaps in the YAML position index. Complex (map/seq) mapping
  keys no longer collapse to `''` and collide in the index — each gets a canonical
  structural serialization, so distinct complex keys resolve to distinct source
  ranges instead of clobbering one another. Subtrees reachable only through a
  `*alias` or a `<<` merge are now indexed too: paths reached through an alias
  resolve to the anchored node, and merged keys resolve to their source location
  (with explicit keys still winning), rather than falling back to the nearest
  ancestor.
- 2392836: Parse multi-document (`---`-separated) YAML streams instead of silently
  dropping everything after the first document.

  `parseYaml` called `parseDocument`, which reads only the first document of a
  stream, so any data, positions, or diagnostics in later documents were invisible
  to the linter. It now uses `parseAllDocuments` and lints each document
  independently: a multi-document source projects to an array of per-document
  values, and every position key and finding path is prefixed with the zero-based
  document index, so a violation in a later document resolves to its own
  line:column range. Single-document sources are unchanged — `data` is still the
  document value and paths stay unprefixed — so existing callers and rulesets are
  unaffected.

- Updated dependencies [74498a7]
- Updated dependencies [175e4f0]
- Updated dependencies [a834a17]
  - @amritk/runtime-validators@0.7.0
  - @amritk/yaml@0.3.0

## 0.2.0

### Minor Changes

- 273bbce: Add a built-in OpenAPI ruleset at the `@amritk/lint/rules/openapi` subpath.

  The core engine stays format-agnostic, but OpenAPI is now available as a ready-made preset layered on top of it — with no new dependencies. The subpath exports the `oas` ruleset, the OpenAPI-specific functions (`oasFunctions` / `allFunctions`), format detectors (`oasFormats`), auto-fixers (`oasFixers`), the bundled structural meta-schemas (`oas2Schema` / `oas3Schema` / `oas31Schema`), and two helpers:

  - `createOpenApiRuleset(definition?, basePath?)` — builds a runnable `Ruleset` with the OpenAPI functions and formats layered over the built-ins, defaulting to `extends: [oas]` (recommended rules only). Feed it to the core `lintWithResult` (with a `$ref` resolver for `resolved: true` rules).
  - `resolveOpenApiRuleset(name, basePath?)` — resolves `extends` references, including the `oas` / `loupe:oas` / `spectral:oas` names so existing Spectral-style rulesets extend unchanged.

  Structural schema validation uses the **official `spec.openapis.org` meta-schemas, vendored as raw `.json` files** (`src/rules/openapi/schemas/`, exported as `oas2Schema` / `oas3Schema` / `oas31Schema` / `oas32Schema`). The 3.0, 3.1, and 3.2 documents are byte-for-byte verbatim from spec.openapis.org; only 2.0 differs (its external draft-04 metaschema `$ref`s are inlined, since the eval-free interpreter never fetches remote documents). OpenAPI 3.1/3.2 express Schema Objects as JSON Schema 2020-12 through a local `$dynamicRef`/`$dynamicAnchor` — which `@amritk/runtime-validators` resolves natively — so no bundling or dialect engine is needed. This replaces the previous hand-written 3.1 envelope (which under-validated the document structure) and adds a new `oas3_2-schema` rule so OpenAPI 3.2 documents are structurally validated too.

  The schemas load **lazily, per version**: building the ruleset embeds no schema (the `*-schema` rules carry only a version tag and validate through the `oasSchema` function), and each `*-schema` rule is format-gated to a single OpenAPI version, so linting a document only ever reads its own version's schema file — the other ~110 KB of schemas are never loaded. Use `loadOasSchema(version)` to access a schema object directly.

## 0.1.0

### Minor Changes

- 195873d: Add `@amritk/lint`: a format-agnostic JSON/YAML style-guide linter with JSON
  Schema and custom rules, in a single package.

  - `@amritk/lint` — parsing (exact source positions), the engine (documents,
    ruleset loading/merging, a compiled JSONPath, the rule runner), the built-in
    rule functions (`schema` (JSON Schema, via `@amritk/runtime-validators`),
    `truthy`, `pattern`, `casing`, `alphabetical`, `length`, `enumeration`, `xor`,
    …), and the auto-fix plumbing. `lintDocument` returns structured findings;
    rendering them is left to the caller.
  - `@amritk/mjst` — gains a `lint` subcommand: `mjst lint <files> -r <ruleset>`,
    with `.lint.*` ruleset discovery, a compact `file:line:col` report, and
    severity-based exit codes.

  JSON/YAML linting with JSON Schema and custom rules only — no OpenAPI-specific
  rulesets, functions, or `$ref` resolution.
