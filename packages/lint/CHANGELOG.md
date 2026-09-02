# @amritk/lint

## 0.5.1

### Patch Changes

- Updated dependencies [5e45680]
  - @amritk/runtime-validators@0.12.1

## 0.5.0

### Minor Changes

- b4be038: Add an AsyncAPI ruleset at `@amritk/lint/rules/asyncapi`, covering AsyncAPI 2.0–2.6 and 3.0.

  The linter has shipped an OpenAPI preset for a while; this is the same layer for
  event-driven APIs, built the same way — a subpath on top of the format-agnostic
  core, adding **no dependencies**:

  ```ts
  import { lint } from "@amritk/lint";
  import { createAsyncApiRuleset } from "@amritk/lint/rules/asyncapi";

  const ruleset = createAsyncApiRuleset(); // recommended rules, like `spectral:asyncapi`
  const findings = await lint(document, { ruleset });
  ```

  56 rules. The names match Spectral's, so an existing `.spectral.yml` that
  re-severities individual rules keeps working; the one Spectral rule with no
  counterpart here is `asyncapi-3-document-resolved`, for the reason below, and
  two have no Spectral counterpart at all — `asyncapi-3-server-security` and
  `asyncapi-3-server-variables`, which close a gap where the 3.0 Server Object's
  `security` and `variables` were checked in 2.x and nowhere in 3.0. 45 of
  them are gated by format,
  with the 3.x-only rules under an `asyncapi-3-` prefix, because 3.0 moved
  operations to the top level and tags under `info` — a 2.x document never picks up
  a 3.x rule. The remaining 11 describe things both majors share (`info`, servers,
  channel parameters, unused components) and run on either.

  New exports: `createAsyncApiRuleset`, `resolveAsyncApiRuleset`, `asyncapi`,
  `aasFunctions`, `allFunctions`, `aasFormats` (`aas2`, `aas2.0`–`aas2.6`, `aas3`,
  `aas3.0`), `loadAsyncApiSchema`, `asyncApiSchemaVersion`, `ASYNCAPI_VERSIONS` and
  `LATEST_ASYNCAPI_VERSION`.

  Three things worth knowing:

  - **The vendored meta-schemas carry three deliberate regex rewrites.** The
    official schemas contain patterns that nest unbounded quantifiers, and one of
    them —
    `^([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$` — is genuinely
    exponential: a trailing invalid character makes the match fail only after
    exploring every way to split the input. `@amritk/runtime-validators` refuses to
    compile any of them, so each is replaced by a provably equivalent pattern with
    a single unambiguous quantifier rather than by opting out of the check. The
    test suite asserts the equivalence over a generated corpus, and fails if a
    re-vendored schema reintroduces an upstream pattern.
  - **Structural validation runs once, against the document as written.** There is
    one meta-schema rule per major and it is `resolved: false`, matching the
    `oas*-schema` rules. The trade-off is what a `$ref` hides: content from another
    file goes unchecked, as does a same-file reference aimed at the wrong kind of
    object — the reference itself is well-formed either way. The OpenAPI preset has
    the same gap.

  - **Which tree each rule sees is chosen per rule, and pinned by a test.** A rule
    that reads what the author wrote — channel addresses, server variables, tag
    names, reference targets — runs unresolved, so a reusable definition is read at
    its declaration and nowhere else. A rule that validates schema _content_ —
    payloads, headers, examples — must see the dereferenced tree, or a `$ref`'d
    schema is an opaque `{$ref: …}` it cannot judge. The consequence, shared with
    the OpenAPI preset and with Spectral, is that a resolved rule reports a mistake
    in a reusable definition once per `$ref` that reaches it.
    `ruleset-manifest.test.ts` pins the choice for all 56 rules alongside severity
    and gating.
  - **The structural rules skip a version they have no schema for.** A future
    `2.7.0` document keeps getting the style rules, but is never judged against
    2.6's meta-schema.

  Internally, the Server Object `variables` check and tag-name uniqueness moved to
  a shared `rules/shared` module, since OpenAPI and AsyncAPI model both the same
  way. `oasServerVariables` and `oasTagsUnique` keep their names, behaviour and
  messages — verified by a finding-for-finding diff of the whole OpenAPI fixture
  corpus. The shared check now takes the address fields to read as an option,
  defaulting to `url`, because AsyncAPI 3.0 splits the address into `host` and
  `pathname`; OpenAPI stays on the default and its wording with it.

- 118aca9: `lintDocument`, `lintDocumentWithResult`, and `fixDocument` now accept a
  `Ruleset` you have already built, not only a definition to build.

  Without this there was no way to use a preset that brings its own functions and
  format detectors through the package-root entry points. Handing them the `oas`
  definition as plain data produced _nothing_: its custom functions are unknown
  there, and — since every OpenAPI rule is format-gated — its `formats` gate
  matched nothing against an empty format registry. The README and `oasFixers`
  both told you to pass the fixers to `fixDocument`, which had no findings to work
  from.

  ```ts
  import { fixDocument } from "@amritk/lint";
  import { createOpenApiRuleset, oasFixers } from "@amritk/lint/rules/openapi";

  const { output, applied } = await fixDocument(source, {
    ruleset: createOpenApiRuleset(),
    fixers: oasFixers,
  });
  ```

  Passing a definition behaves exactly as before. `rulesetBasePath` and
  `restrictTo` only apply while building, so they are ignored for a ruleset that
  already is one.

- 41b14ae: Add a `skipUnusableSchema` option to the built-in `schema` function.

  When the runtime validator cannot build or run a schema — most often a `$ref` it
  cannot resolve, which only surfaces when the validator runs — `schema` reports
  why. That is right for a schema written in the _ruleset_: if that one is
  unusable, its author wants to hear about it.

  It is wrong for a schema taken from the _document_. A message payload or a
  parameter's schema can legitimately carry a reference this package cannot
  follow: an external file, or anything at all when no `$ref` resolver was
  injected. There the validator's complaint is not a finding about the document —
  it is an error-severity diagnostic, on a valid document, whose text describes
  this package's own API and tells the reader to pass `{ schemas: … }`.

  Callers validating a document-supplied schema pass `skipUnusableSchema: true`
  and get silence where they cannot judge. The default is unchanged, so no
  existing ruleset behaves differently. The OpenAPI preset's example rules already
  did this with their own validator wrapper; the AsyncAPI payload, example and
  default rules now do it through this option.

- e65a96b: Report each finding at the node the author actually wrote, and stop reporting the
  same one twice.

  Three changes, all about a finding's `path` and where it points.

  **A finding's `path` is now the path in the document it is reported against.** A
  rule that runs against the dereferenced tree matches a position that need not
  exist in the source: `paths./pets.get.parameters.0.name` where the author wrote
  `$ref: '#/components/parameters/Id'`. The `range` and `source` already pointed at
  the declaration, so `path` disagreed with them — it named a node in a third tree,
  one that no editor could jump to and that a fixer resolving it against the raw
  document would not find. `path` now names the same node the range does. Nothing
  changes for an unresolved rule, or for a finding on a node with no `$ref` above
  it.

  **A `$ref` with siblings is read where it was written.** `{ $ref: '#/…/Usage',
nullable: true }` is how an OpenAPI document overrides a shared schema: the
  `nullable` lives at the `$ref` site and exists nowhere in the target. The
  translation back to the source followed the `$ref` regardless, producing
  `components.schemas.Usage.nullable` — a node nobody wrote. The finding then took
  the range of the whole `Usage` schema (the nearest ancestor that does exist), and
  the migration fixer for it silently did nothing. Both are fixed: a segment the
  `$ref` object owns itself stops the walk, so the finding lands on the override,
  and `--fix-unsafe` rewrites it. On the OpenAPI corpus this turns two findings
  pointing at two 30-line schemas into four pointing at the four `nullable: true`
  lines that caused them.

  **Identical findings are collapsed.** With a resolver, a mistake in a
  `components` entry is reported once per `$ref` reaching it — same rule, same
  severity, same message, same `line:column`, now also the same `path`. Copies
  after the first told a reader nothing, so only the first survives. Findings about
  _absent_ fields keep their own paths and so all survive: `info.contact` missing
  `name`, `url` and `email` share the enclosing object's range but remain three
  problems.

  Also: `--fix` no longer feeds a fixer findings from a file inlined by the
  resolver. Those paths are relative to the other document, so applying them here
  edited whatever happened to sit at the same path.

### Patch Changes

- b6dcb13: Pin the AsyncAPI meta-schema regex verdicts to what the ReDoS screen actually
  does today.

  The three upstream patterns this package rewrites were all refused by
  `@amritk/runtime-validators` when the schemas were vendored, and a test asserted
  that refusal as the reason for each rewrite. The screen has since been relaxed
  to admit _separator-anchored_ repetitions — a loop whose every iteration must
  begin with a character the body cannot itself produce — and it named two of
  these three as its motivating cases. Only the genuinely exponential one is still
  refused, so the test's premise was false for the other two.

  The test now records the expected verdict per pattern and asserts it in both
  directions: a refusal that becomes an acceptance and an acceptance that becomes
  a refusal both fail. Pinning only the refusals would let a later relaxation
  quietly admit the exponential pattern; pinning nothing would hide a
  re-tightening that made these schemas fail to build again.

  All three rewrites stay. Two are no longer required for the schemas to build,
  but each is proven equivalent to its upstream over a generated corpus, and one
  flat loop reads more clearly than a nested pair. The README, `AGENTS.md`, and
  the architecture guide previously said all three were refused; they now say
  which is, and why the other two are kept anyway.

  No runtime behaviour changes.

- 0f27eeb: Re-measure every published benchmark table on Bun 1.4.

  The tables were labelled Bun 1.3 and predate both the runtime upgrade and this
  release's interpreter work, so every one of them was re-run rather than
  relabelled. All measurements come from one Linux x64 box with nothing else on
  it, each package's own `bun run bench`, and the machine is named in each table's
  caption — compare columns within a table, not against a figure you remember.

  Three of them changed in ways a version label would have hidden:

  - **`@amritk/lint`** — Spectral's JSONPath engine used to throw on the 2.8 MB
    OpenAI spec under Bun, so that row was published as mjst-only. It no longer
    throws, and the row is a real comparison now (~0.73 s against ~7.4 s). The
    bench keeps its guard, since that failure was runtime-specific.
  - **`@amritk/api`** — Bun 1.4 made web-standard `Request`/`Response`
    construction far cheaper, which lifted every column of the Bun table (bare
    Hono went ~185k → ~503k ops/s). The compiled engine still leads the
    like-for-like `hono + zod` column on Bun and Node, but it no longer leads
    _unvalidated_ Hono on the GET cases, and under workerd it now trails
    `hono + zod` on the static GET. The prose says so.
  - **`@amritk/runtime-validators`** — the interpreter is much faster than when
    the ratios against Ajv were written, so the cold-path win narrows to ~96–870×
    (from ~90–1600×) and the steady-state loss narrows to ~6–11× (from ~15–25×).

  `@amritk/generate-parsers`, `@amritk/generate-validators`, `@amritk/resolve-refs`
  and `@amritk/yaml` keep the same shape and conclusions with refreshed numbers.

- d8ceda5: A `**` inside a brace alternation collapses the slash that follows the group
  again.

  `**` only becomes `(?:.*/)?` when it can see the `/` after it, and compiling
  each alternative in isolation hid that slash — so `{**,dist}/x.yaml` produced
  `(?:.*|dist)/x\.yaml`, which demands a slash and no longer matched a root-level
  `x.yaml`. The brace _expansion_ this replaced (for being exponential in the
  number of groups) did match it. A `/` immediately after a group is now folded
  into each alternative, so `**/` collapses while `dist/` keeps its literal slash.

- e65a96b: Make the JSONPath engine agree with itself about what a node's members are.

  A node's members are its own **enumerable** string keys — what a JSON or YAML
  parser produces, and what every walk in the engine (`$..`, `$.*`, filters, and
  the descent shared across a ruleset's paths) enumerates. Naming a key directly
  used a plain own-property check instead, so a non-enumerable own property was
  addressable by name but invisible to every walk. Same expression, different
  answers: `query(data, '$..secret')` found it, while the batched `queryMany` —
  which seeds from one shared descent — did not. Filter member reads (`@.secret`)
  had the same split.

  Only reachable when a caller hands the linter a hand-built object rather than a
  parsed document, and there is no measurable cost to the check. Inherited
  properties stay invisible either way.

- 06261b1: Report a malformed ruleset entry by name instead of crashing with a `TypeError`.

  A rule written `my-rule:` with no body is `null` in YAML, and the author was told
  "Cannot read properties of null (reading 'severity')". Seven more shapes failed
  the same way — a rule entry that is a number or an array, an override entry that
  is `null`/`undefined`/a number, a rule with no `given`, a `given` that is not a
  string. Each is now a named error raised while the ruleset is built:

  - `Rule "my-rule" must be a rule definition, a boolean, or a severity — got null`
  - `Rule "my-rule" is missing \`given\``
  - `Rule "my-rule" has an invalid \`given\`: expected a JSONPath string, got \`number\``

  Malformed _override_ entries are checked at build time too; because overrides
  apply per document, they previously surfaced from the middle of a lint run.

  A file-glob override may now also give a severity as its numeric LSP level
  (`{ 'my-rule': 1 }`), which is what the pointer-scoped override path already
  accepted; it used to be misread as a full rule definition.

  Also adds a seeded fuzz sweep that crosses random rulesets with awkward
  documents and asserts the engine never fails in a way it cannot explain.

- eb58f18: Name the malformed part of a ruleset instead of failing deep inside it.

  Following on from the malformed-rule-entry fix, five more shapes surfaced as a
  `TypeError` from wherever the value was first touched: `overrides` that is not an
  array ("overrides is not iterable"), an override with no `files` globs ("Cannot
  read properties of undefined (reading 'filter')" — once per linted document,
  because `files` is read per document), a `formats` gate that is not an array
  ("number 5 is not iterable"), an `extends` entry that is neither a string nor a
  ruleset object, and a definition that is not an object at all ("Invalid value
  used as weak map key", from the memoization layer). Each is now a named error
  raised while the ruleset is built.

- be45c14: Harden the engine against names that collide with `Object.prototype` members, and stop brace globs from exploding.

  - A pointer-scoped override could set a finding's severity to a _function_: both
    the rule code and the severity name were read off the prototype chain, so
    `'constructor'` passed the membership check. Every later comparison against
    `DiagnosticSeverity.Error` then read false, so a CLI would exit 0 on a document
    it should fail. Rule codes, severity names, `then.field`, `{{template}}`
    placeholders, and `parserOptions` severities are now all own-property reads.
  - `oasDiscriminator` and `oasServerVariables` tested membership with `in`, so a
    discriminator named `constructor` or a `{constructor}` server-URL template read
    as already defined and the finding went unreported.
  - An override `files` glob compiled its brace groups into a cartesian product of
    concrete globs: `'{a,b}'.repeat(22)` — 110 characters — took ~40 seconds and
    built a 96 MB regex source. Groups now compile in place as regex alternations,
    which is linear in the pattern's length, and the compiled-pattern cache is
    bounded like the engine's other memoization maps.

- 178eab0: Document the one thing `restrictTo` does not cover: a regular expression a
  ruleset writes (in `pattern`'s `match`/`notMatch`, or as a literal inside a
  `[?(...)]` filter) is run against text from the document, so an ambiguous pattern
  can backtrack catastrophically on input crafted to trigger it — a hostile
  _document_ hanging the linter through a regex the _ruleset_ provided.
- 5563205: Index `$ref` targets once instead of rescanning per component, and cap filter nesting.

  - `unreferencedReusableObject` and `oasUnusedComponent` each rescanned the whole
    `$ref` set for every component — and the former copied that set into a fresh
    array on each one. Both now share one index of every ref and its ancestors: on
    a document with 5,000 refs and 3,000 components the check drops from ~810 ms to
    ~10 ms, and the duplicated ref walk is gone.
  - `or`, `xor`, and `typedEnum` read through the prototype chain. A rule listing
    `constructor` counted it as present on every object, and a schema written
    `type: valueOf` produced a bogus error-severity "rule threw" finding.
  - A deeply nested `[?(...)]` filter failed with "Maximum call stack size exceeded
    at offset undefined", at a threshold that varies by runtime. Filters now refuse
    to nest past 100 levels with a message that says so, and an error no longer
    echoes an unbounded expression body.

- 7ca3bd8: Share one ruleset-file loader between the package root and the OpenAPI preset, and isolate three more failure paths.

  `@amritk/lint/rules/openapi` carried its own copy of the `extends`/custom-function
  loader, and the copies had drifted:

  - `createOpenApiRuleset` crashed with a stack overflow on a two-file `extends`
    cycle (`a.yaml` → `b.yaml` → `a.yaml`). Each file read returns a fresh object,
    so an object-identity cycle guard never fires; the shared loader keys on the
    resolved `(basePath, reference)` edge.
  - `createOpenApiRuleset(definition, basePath, { restrictTo })` and
    `resolveOpenApiRuleset(name, basePath, { restrictTo })` now accept the same
    trust boundary the package root has had.

  Also:

  - A `$ref` that is not a URL relative to a remote document (`$ref: "//"`) threw a
    `TypeError` out of the whole lint run; it now stops the origin walk, like any
    other `$ref` that cannot be followed.
  - A fixer that throws no longer abandons every other fix queued behind it.
  - `loadOasSchema` reports an unknown OpenAPI version by name instead of failing
    inside `JSON.parse`.

- 41f8173: One severity table and one finding comparator, instead of three and two.

  The severity-name mapping was written out in three places (rule normalization,
  pointer-scoped overrides, and parser options) and the finding-order comparator in
  two. Nothing was wrong with any individual copy after the preceding fixes, but a
  severity added to one of them would have been silently missing from the others.
  Both now live in one module each.

  Also extends the fuzz sweep to the JSONPath compiler: a path that fails to
  compile must match nothing (falling back to the document root would run a rule
  against the whole file), and evaluating a batch of paths must return exactly what
  evaluating each one alone does.

- c6a1f16: Read each schema node's keywords once, compile lint filters, and match descents by key.

  - **`@amritk/runtime-validators`** — the interpreter walked the schema afresh for
    every value and asked each node for every keyword it might carry on every one of
    those walks: about two dozen `Object.hasOwn` plus dynamic-key reads per node, per
    validation. A CPU profile of the steady-state benchmark put 31% of the whole run
    inside that one reader. A node's keywords are now read once into a fixed-shape
    record and reused, which makes each read a fixed-offset field load instead of a
    megamorphic dictionary lookup, moves the `typeof` narrowing off the hot path, and
    lets group flags skip the reference, branching and type-specific blocks outright.
    Steady-state throughput is 2.1–3.6× on the benchmark cases. Building the record
    walks the node's own keys — three or four, rather than two dozen questions — so it
    is cheaper than a single old scan, and the cache only starts filling on a
    validator's _second_ call, leaving the cold one-shot path unchanged-to-better.
    `@amritk/api`'s runtime engine and `@amritk/lint`'s `schema` rule both run this
    interpreter, so both inherit it.
  - **`@amritk/helpers`** — `generateIndexBarrel` read every character of every
    generated file looking for `export` at a line start, which was ~18% of a
    generation run. It now jumps between `export ` occurrences with `indexOf`, taking
    roughly a quarter off generation time per parser.
  - **`@amritk/lint`** — `[?(...)]` filter bodies compile to closures once instead of
    being walked as an AST on every document node (still no `eval`/`new Function`;
    these are ordinary closures over the parsed tree), recursive descents ask which
    paths wanted each key the node has rather than asking every path in turn, and two
    `/^\d+$/` tests moved off the hot path. Linting the vendored real-world specs:
    petstore 11.1 → 7.4 ms, openai 1780 → 1110 ms.

- Updated dependencies [4d5f1bb]
- Updated dependencies [0f27eeb]
- Updated dependencies [2162f87]
- Updated dependencies [c6a1f16]
- Updated dependencies [dcfe9a9]
- Updated dependencies [f938dd7]
- Updated dependencies [b3364fd]
- Updated dependencies [7e452e1]
- Updated dependencies [b957e36]
  - @amritk/runtime-validators@0.12.0
  - @amritk/yaml@0.7.2

## 0.4.8

### Patch Changes

- 34c5eaf: Stop resolving ruleset and document names against `Object.prototype`, and make
  the tags fixer converge.

  Five lookups indexed a plain object with a name taken from ruleset or document
  input, so any name that happens to be an `Object.prototype` member resolved to
  one. A `then.function` of `"toString"` ran instead of being reported unknown,
  its string return value iterated one character at a time into a diagnostic
  apiece. A rule code of `"toString"` matched the fixer registry and threw out of
  `applyFixes`, abandoning every other fix in the batch. An alias of
  `#constructor` was written into the alias table as a real own key and then
  threw out of the whole lint run. A `severity` of `'constructor'` built a rule
  carrying a `Function` where a `DiagnosticSeverity` belongs, so every comparison
  against `DiagnosticSeverity.Error` read false and the CLI exited 0 on findings
  it should have failed for. And a path parameter legitimately named
  `constructor` was reported as "defined multiple times" against a single
  definition, while one named `__proto__` never registered at all.

  `openapi-tags-alphabetical`'s fixer restated the `alphabetical` built-in's
  comparator instead of using it, and the copy had drifted — so
  `tags: [{name: "10"}, {name: "2"}]` was flagged by the rule and read as already
  sorted by the fixer, surviving every `--fix` pass. The comparator is now shared.
  It is deliberately not a total order (that is what lets both `["2","10"]` and
  `["0x10","9"]` read as ordered), so the fixer also checks its own sort result
  and leaves the array alone rather than emitting an order the rule still rejects
  — which used to burn every fix pass and report `converged: false`.

  `IFixResult.fixed` is documented as whether any fix changed the document, but
  was derived from the applied-fix list; it now reports what it documents. The
  own-property guards live in one `core/own-key` module rather than three copies,
  and the raw NUL byte in `ruleset.ts` is now the `\0` escape, so the file diffs
  as text instead of as binary.

- Updated dependencies [34c5eaf]
  - @amritk/runtime-validators@0.11.0

## 0.4.7

### Patch Changes

- 4178e8d: Patch release across all packages.
- Updated dependencies [4178e8d]
  - @amritk/runtime-validators@0.10.1
  - @amritk/yaml@0.7.1

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
