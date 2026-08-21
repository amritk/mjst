# @amritk/runtime-validators

## 0.12.0

### Minor Changes

- dcfe9a9: Harden the interpreter against hostile schemas, and share one copy of the keyword sets.

  - `$schema`/`$vocabulary` are now read as own keys. A polluted `Object.prototype.$vocabulary` alongside a `$schema` naming a registered document turned the whole 2020-12 validation vocabulary into annotations, so `type`, `enum`, `required` and the bounds stopped asserting and every value validated.
  - The ReDoS screen no longer becomes a denial of service itself. Its group descent is depth-capped (a deeply nested pattern raised an uncatchable `RangeError` instead of a `ValidationLimitError`), and its pairwise ambiguity scan runs on a shared comparison budget (a few kilobytes of `(a|b|c|…)+` pinned a CPU for minutes at build time).
  - `$ref`, `$dynamicRef` and `$recursiveRef` each resolve through their own target cache. They shared one map under prefixed keys, so a `$ref` to an unregistered URI spelled `dyn:#x` read back the target of an earlier `$dynamicRef: '#x'` instead of failing loudly.

### Patch Changes

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

## 0.11.0

### Minor Changes

- 34c5eaf: **Behavior change:** an inherited property no longer counts as present. A value
  built over a prototype — `Object.create(defaults)`, or a class instance —
  previously satisfied `required` and had its inherited keys validated against
  `properties`; it no longer does, which is what the own-key sweeps
  (`minProperties`, `additionalProperties`, `unevaluatedProperties`) always
  believed. JSON-derived values, which is what a JSON Schema validator normally
  sees, are unaffected.

  Answer "does the instance have this property?" one way, and stop reading
  schemas off the prototype chain.

  The presence test was a `!== undefined` read with an exemption list for the
  standard `Object.prototype` names, and it disagreed with `minProperties`,
  `additionalProperties` and `unevaluatedProperties`, which sweep the instance's
  own keys: `Object.create({ token: 'x' })` — a value that serializes to `{}` —
  satisfied `required: ['token']` while every other keyword agreed it had no
  properties. `hasProperty` is now `Object.hasOwn(obj, key) && obj[key] !==
undefined`, and every keyword that asks the question calls it. The exemption
  list is gone.

  The four instance sweeps (`additionalProperties`, `patternProperties`,
  `propertyNames`, `unevaluatedProperties`) iterate own keys, so an inherited key
  is no longer validated as though the instance carried it — and a polluted
  `Object.prototype` no longer makes `additionalProperties: false` reject every
  object in the process.

  **Every schema keyword is read as an own property.** Schemas arrive at runtime,
  and a bare `s['additionalProperties']` or `'propertyNames' in s` answers from
  `Object.prototype` when a dependency has polluted it — so a single polluted
  name turned a keyword on for every schema in the process:
  `additionalProperties: false` rejected every object with an extra key,
  `propertyNames` rejected every key, `minimum: 999` rejected every number. All
  44 keyword reads now go through one own-property helper, and
  `prototype-pollution.test.ts` enumerates the whole surface — 41 keywords,
  polluted one at a time — so the next one cannot be found one review at a time
  the way these were.

  An unrecognized `format` is ignored, as the spec says. The checks table was
  indexed directly, so `format: "toString"` found a `Function.prototype` method —
  truthy, with no `.test` — and threw a `TypeError` on a schema it should simply
  have accepted.

  The limits walker gained the same schema-node-versus-name-map distinction: a
  definition named `default` was skipped outright, so an `$id` under it never
  registered and a `pattern` under it was never screened — a
  catastrophic-backtracking regex compiled and ran with no `allowUnsafePatterns`
  opt-in.

## 0.10.1

### Patch Changes

- 4178e8d: Patch release across all packages.

## 0.10.0

### Minor Changes

- bc09e15: `validateGuard` stops narrowing where the inferred type cannot describe every
  accepted value

  `FromSchema` infers an object shape from applicator keywords alone, so
  `{ properties: { a: { type: 'string' } } }` infers `{ a?: string }`. The
  interpreter — correctly — accepts a non-object against that schema, because JSON
  Schema's object keywords ignore values that are not objects. The guard was
  therefore handing back `input is { a?: string }` for a `42` it had just approved.

  For exactly those schemas — no `type`, `enum`, `const` or `$ref`, but
  `properties`, `required`, `additionalProperties`, `patternProperties`,
  `prefixItems` or `items` present, recursing through `allOf`/`anyOf`/`oneOf`
  branches — `validateGuard` now returns a `Check<T>` instead of a `Guard<T>`: the
  same runtime function, no type predicate. Every schema that declares a `type` (or
  `enum`/`const`/`$ref`) keeps its predicate, and so does a schema whose type is not
  a literal — narrowing is surrendered only when the inference is _demonstrably_
  partial, never because the checker could not decide.

  `Check<T>` keeps the erased phantom carrier `Validator` already uses, so
  `Infer<typeof check>` still recovers the schema's type rather than collapsing to
  `never`, and it is assignable anywhere `(input: unknown) => boolean` is. It reads
  as "checks for this, does not claim it".

  The runtime is untouched. This mirrors the same fix in
  `@amritk/generate-validators`, whose generated `isX` had the identical hole — the
  two now tell one story about the same schemas, and the type-level predicate sits
  next to `ImplicitShape` so the keyword lists cannot drift apart.

- b152c4e: Resolve `$ref` against `$id` as a base URI, and give `$dynamicRef` a real dynamic
  scope

  Measured against the official JSON Schema Test Suite, the interpreter goes from
  1183/1299 to **1250/1299 (96.2%)**. Sixty-seven cases, one cause: a `$ref` written
  against an `$id` — relative (`"list"`), absolute
  (`"http://example.com/b/d.json"`), or a URN — had nothing to resolve against and
  threw, even when the resource it named sat _inside the same document_.

  The document is now walked once into a registry of its embedded resources: each
  `$id` composed against the base of its parent, and each resource's `$anchor`s and
  `$dynamicAnchor`s registered under it. A ref resolves against the base in scope at
  the referring node — relative, absolute, URN, absolute-path, pointer-into-resource
  and anchor-in-resource forms all work — and `$dynamicRef` implements bookending
  properly: it goes dynamic only when static resolution already lands on a
  `$dynamicAnchor` of that name, then takes the outermost resource in the dynamic
  scope declaring it.

  Two behavior changes fall out of that, both spec-correct and both confined to
  documents that declare an `$id`:

  - A `#/pointer` inside an `$id` scope resolves within that resource rather than at
    the document root. A scoped ref that names nothing in its own resource still
    falls back to the document-global lookup, so a bundled schema that worked before
    works unchanged — the new path can only _add_ an answer.
  - `contains` publishes the indices it matched rather than sweeping the whole
    array, so an adjacent `unevaluatedItems` sees the right set. This is where the
    spec and Ajv disagree; the suite agrees with the spec, and so do we. The pair is
    excluded from the Ajv differential corpus and covered by unit tests plus the
    suite instead.

  Cost is kept off the common path: the registry is `null` for a document with no
  `$id` at all, the `$id` scan is fused into the pattern-screening walk that already
  happened, and resolutions are memoized per validator. Eval-free, synchronous,
  zero-dependency and no-I/O all hold.

  What remains unimplemented is now one decision rather than two: this package does
  no I/O, so a `$ref` naming _another document_ (and `$vocabulary`, which means
  fetching a metaschema) still throws. Bundle with `@amritk/resolve-refs` first.

- 140412b: Take documents the caller already has: `validate(schema, { schemas })`

  The interpreter does no I/O — no `fetch`, no filesystem — which is what lets it
  run under a strict CSP and on Workers. Until now that also meant it could not be
  _told_ about a document it did not receive, so a `$ref` naming another schema
  threw and the answer was always "bundle it first".

  `ValidateOptions.schemas` closes that without giving up anything: a plain record
  of absolute URI → document, for schemas the caller has already loaded. A
  registered document is a full schema resource — walked under its retrieval URI, so
  its `$id`, `$anchor`s, `$dynamicAnchor`s and nested embedded resources all
  register, a document with no `$id` resolves relative refs against the URI it was
  registered under, and one whose `$id` disagrees answers to both. Cross-document
  `$dynamicRef` bookending works. A URI that was _not_ registered still throws, now
  with a message showing how to supply it.

  It is a record rather than an `addSchema` call on purpose: `addSchema` implies
  mutable global state, and this package stays a pure function of its inputs. Pass
  the registry as an immutable value — the prepared-validator cache keys on its
  identity _and_ its URI set, so adding or removing a document is a cache miss
  rather than a stale hit (swapping the contents under a URI in place is
  undetectable, exactly as mutating the schema object is, and is documented as
  such).

  With the metaschema registered, `$vocabulary` can finally be read: a custom
  dialect that omits the validation vocabulary turns `minimum` and friends into
  annotations instead of assertions. Two limits, both documented: it is read from
  the root `$schema` rather than per schema resource, and it defaults to enforcing
  whenever the metaschema was not registered, which is the stricter answer.

  Nothing changes for callers who pass no registry: the key work is skipped, the
  registry build stays gated on the document declaring an `$id`, and the vocabulary
  check short-circuits.

  **The package now passes the official JSON Schema Test Suite in full — 1299 / 1299
  required Draft 2020-12 cases.** The harness hands the suite's own `remotes/`
  documents to `schemas`, which is the sanctioned equivalent of the HTTP server the
  suite would otherwise expect: same documents, same URIs, handed over instead of
  fetched, with the interpreter still doing all the base-URI, anchor and
  cross-document work the cases exist to test.

  The dialect itself ships alongside, as an opt-in subpath:

  ```ts
  import { metaschema } from "@amritk/runtime-validators/metaschema";

  validate(userSchema, { schemas: metaschema }); // "is this a valid 2020-12 schema?"
  ```

  Eight documents (the dialect plus its seven vocabulary metaschemas), ~7.9 KB of
  JSON, reachable only through that subpath — the main entry never imports it, so a
  caller who does not ask for it ships none of it. A test holds the copy to Ajv's
  vendored specification text by deep equality, which makes Ajv a _check_ on the
  transcription rather than a runtime dependency of it.

### Patch Changes

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

- 15e480e: Widen the ReDoS screen, fix five correctness defects, and cut five allocations off the hot path

  **The ReDoS screen only looked where it expected schemas to be.** It walked a
  fixed list of subschema keywords, so an OpenAPI-shaped document — subschemas
  parked under `components/schemas` and reached by `$ref` — was declared clean and
  its `pattern`s were then compiled and run unscreened. `{ $ref:
'#/components/schemas/A', components: { schemas: { A: { pattern: '^(a+)+$' } } } }`
  burned ~1.3 s of CPU on a 31-character input, while the same pattern inlined at
  the root was correctly rejected. The walk is now unrestricted: every
  string-valued `pattern` key and every `patternProperties` key anywhere in the
  document is screened, wherever it sits. Chasing `$ref`s instead would have fixed
  that one layout and missed the next unfamiliar one. `const`, `enum`, `default`,
  `examples` and `example` are still skipped, because a schema is allowed to carry
  arbitrary data there and `{ const: { pattern: '(a+)+' } }` describes an object,
  not a regex. This does cost cold build time in proportion to the document
  actually being screened — an ordinary component schema is unchanged (~0.016 ms),
  but handing `validate` a whole OpenAPI document now costs ~0.25 ms once, where
  the old walk visited almost none of it.

  **The screen's documented guarantee was false, and is now both honest and
  stronger.** It claimed to "flag a few benign patterns, never the reverse", but it
  only recognized _nested_ unbounded quantifiers: `^(a|a)+$` is star height 1, so
  it passed — and takes over a second on a 29-character input, doubling with each
  added character. The screen now also rejects a provably ambiguous alternation
  under an unbounded quantifier (two branches that match the same single
  character), and the docs say plainly that this is a filter for recognizable
  shapes, not a proof of safety — `(a|aa)+` and `a*a*$` still get through. The new
  rule is deliberately sound rather than broad: the tempting "overlapping first
  characters" test would flag `(ab|ac)+`, which is linear. Zero new flags across a
  sweep of 27 ordinary real-world patterns.

  **A deeply nested schema threw an uncatchable `RangeError`.** The pattern screen
  and the `$anchor` search both recursed per schema level, and both run before
  `maxDepth` applies — so 20,000 nested `{ "not": … }` levels overflowed the native
  stack, `isValidationLimitError` returned `false`, and a consumer's limit handler
  fell through to a 500. (At 10,000 levels it correctly threw
  `ValidationLimitError`.) Both walks are now iterative with an explicit stack, so
  the depth cap does its job and an anchor buried 20,000 levels down still
  resolves.

  **`required` was silently unenforced for prototype-member names.** The
  leftover-required list was built with `k in properties`, which walks
  `Object.prototype` — so `'toString' in {}` was `true`, the key looked already
  covered and was dropped, and it was absent from the declared-key list too (that
  comes from `Object.keys`). Nothing checked it: `{ required: ['constructor'],
properties: {} }` accepted `{}`. Ajv shares this bug by default, so the
  differential fuzz could not catch it; there are explicit tests now.

  **`format: 'ipv4'` accepted leading zeros** (`01.2.3.4`), the classic
  octal-interpretation allowlist bypass, and the same octets are embedded in the
  IPv6 grammar. **`format: 'time'` accepted a bare `12:00:00`** with no offset,
  which RFC 3339 `full-time` requires. Both now match Ajv exactly.
  **`minProperties`/`maxProperties` counted inherited properties** — a `for…in`
  without an own-property guard — so `Object.create({ inherited: 1 })` with one own
  key satisfied `minProperties: 2`.

  **Five hot-path costs, measured before and after:**

  - The `enum` failure message was built eagerly and thrown away in guard mode. A
    500-value enum cost 16.4k ops/s on a miss versus 5.1M on a hit — ~99% of the
    work was a discarded string. This also hit the _valid_ path, because every
    non-matching `anyOf`/`oneOf` branch probe runs in guard mode: a 20-branch
    discriminated union with `enum` discriminators went 9.5k → 251k ops/s (26×).
    The miss itself is now 5.6M ops/s (340–540×).
  - `contains` evaluated every element even after it had enough matches. A
    1000-element array matching at index 0 went 8.1k → 5.1M ops/s (630–740×). The early
    exit is taken only when `maxContains` is absent and no annotation scope is
    active — both need the exact total.
  - `dependentRequired` / `dependentSchemas` / `dependencies` rebuilt their
    `Object.entries` on every validation. Their entry lists are now memoized on the
    per-node metadata alongside the property keys and compiled `patternProperties`,
    worth 1.3–1.9× on a one-entry keyword. An `additionalProperties`-only object
    schema also stopped allocating a throwaway empty pattern array per call (1.12×).
  - `propertyNames` allocated a nine-field interpreter context per key. One scratch
    context is now reused across the key loop — safe because the only per-probe
    state is the `failed` flag and these probes cannot nest, the key being a string.
    A 20-key object gains 1.9–2.5×.
  - The own-property count for `minProperties`/`maxProperties` uses
    `Object.keys().length`, which measured 92M ops/s against 19M for the old
    unguarded `for…in` and 9.5M for a `for…in` with a `hasOwn` guard — so the fix is
    also 1.14× faster than the bug.

  **The per-schema validator cache is bounded.** The outer `WeakMap` collects with
  the schema, but the inner `Map` keyed on mode/formats/limits lived as long as the
  schema did, so a caller deriving `limits` per request pinned a validator forever:
  200,000 distinct values retained 82.3 MB. Past 16 configurations it now hands
  back an uncached validator (0.5 MB), which costs nothing — there is no compile
  step.

  **Two documentation claims corrected.** The README said valid input "and the
  entire guard path allocates nothing"; branch probes, annotation trackers and
  `uniqueItems` sets all allocate, so it now says what is actually true — nothing
  is built for errors that never happen. And the `$ref` cycle-break comment claimed
  "stopping here changes no verdict", which holds in a conjunctive position but not
  inside a disjunction, where returning valid _is_ a verdict.

## 0.9.1

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

## 0.9.0

### Minor Changes

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

## 0.8.0

### Minor Changes

- b4cd20a: Add resource limits that keep an adversarial schema or input from turning a
  validation into a denial-of-service. The interpreter walks arbitrary (and
  possibly untrusted) schemas over arbitrary data, so four unbounded costs are now
  bounded — all on by default, all configurable via a new `limits` option on
  `validate`/`validateGuard`/`assert`:

  - **Recursion depth** (`limits.maxDepth`, default 512): deeply-nested data
    against a recursive schema (`{ items: { $ref: '#' } }`) no longer recurses into
    the native stack limit as an uncatchable `RangeError`.
  - **Total work** (`limits.maxSteps`, default 10,000,000): a nested `anyOf`/`oneOf`
    that re-evaluates every branch against one value (`2^depth` evaluations from a
    few kilobytes of schema) now trips a shared step budget instead of pinning a
    CPU.
  - **`uniqueItems`**: the structural-equality check is now hash-bucketed, so an
    array of distinct objects is ~O(n) instead of O(n²) (a 40k-element array went
    from tens of seconds to milliseconds). `deepEqual` semantics are unchanged.
  - **ReDoS**: a schema `pattern` (or `patternProperties` key) with nested
    unbounded quantifiers (`(a+)+$`, star height ≥ 2) is rejected when the
    validator is built, before it can be run natively against input. Opt out per
    call with `limits.allowUnsafePatterns: true`.

  Exceeding a runtime limit throws a `ValidationLimitError` — the same fail-loud
  contract the interpreter already uses for an unresolvable `$ref` or unknown
  `type` — recognizable via the newly exported `isValidationLimitError`. The
  `ValidateLimits` type is exported too. Ordinary schemas and documents stay well
  under every default. `@amritk/api`, which validates requests through this
  package, inherits the protection.

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.

## 0.7.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.

## 0.7.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).

## 0.7.1

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

## 0.7.0

### Minor Changes

- 175e4f0: Close three silent-permissiveness edges:

  - An unknown `type` value (`type: "strng"`) now throws when consulted instead
    of matching everything — a typo'd type is a schema error, and silently
    accepting all data disabled the constraint. Same loud contract as an
    unresolvable `$ref`.
  - `$recursiveRef` / `$recursiveAnchor` (draft 2019-09) are now supported,
    binding to the document's `$recursiveAnchor: true` subschema (or the root),
    instead of being silently ignored.
  - `idn-hostname` joins the built-in opt-in formats; previously enabling it
    validated nothing.

### Patch Changes

- 74498a7: Fix seven fail-open and edge-case bugs found in a validator audit:

  - `multipleOf` used a `1e-8·|q|` tolerance that grew ~10⁷× larger than the
    actual floating-point error, silently accepting clear non-multiples at
    realistic magnitudes (e.g. `1000000.005` against `multipleOf: 0.01`). Integer
    divisors now use an exact `%` check (also accepting huge true multiples like
    `1e21`), and fractional divisors use an error-scaled tolerance.
  - `NaN` slipped through `minimum`/`maximum`/`exclusive*` because each bound was
    written in fail-if form, where `NaN < min` is `false`. Bounds are now
    pass-condition checks, so `NaN` fails them — matching Ajv, whose `strict:false`
    oracle also rejects `NaN` against a bound. (A bare `type: 'number'` with no
    bound still accepts non-finite values, as Ajv does; `±Infinity` continues to
    follow ordinary comparison.) `multipleOf` now also rejects every non-finite
    value.
  - Local `$ref` JSON Pointer resolution used the `in` operator, which walks the
    prototype chain — a mistyped pointer like `#/$defs/toString` resolved to
    `Object.prototype.toString` and was treated as an accept-anything schema.
    Resolution now uses own-property lookup and only accepts numeric index tokens
    into arrays, so unresolvable refs fail loudly.
  - `deepEqual` (used by `const`/`enum`/`uniqueItems`) had no cycle guard and
    threw a `RangeError` on self-referential input; it is now depth-capped so
    cyclic values fail comparison instead of crashing the validator.
  - `uniqueItems` treated `NaN` as equal on its all-primitive fast path but not on
    its structural slow path; `deepEqual` now uses SameValueZero so both agree.
  - The `ipv6` format rejected the unspecified address `::`.
  - `dependentRequired`/`dependentSchemas`/`dependencies` tested property presence
    with `Object.hasOwn` while `required`/`properties` used `!== undefined`, so
    `{ a: undefined }` was simultaneously absent for `required` and present as a
    dependency trigger. Presence is now uniform across all keywords.

## 0.6.4

### Patch Changes

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

## 0.6.3

### Patch Changes

- 4aa1c6e: Fix two interpreter divergences from Ajv surfaced by differential fuzzing:

  - `patternProperties` now applies to keys that are also declared in
    `properties`. Previously such a key was skipped entirely, so a value matching
    both a `properties` entry and a `patternProperties` regex was only checked
    against the former (e.g. `{ num_x: [1] }` wrongly passed
    `properties.num_x` + `patternProperties['^num_']: { type: 'integer' }`).
  - `additionalProperties: true` now annotates every additional property as
    evaluated, mirroring `items: true` for arrays, so a sibling
    `unevaluatedProperties: false` no longer rejects those properties.

## 0.6.2

### Patch Changes

- 0f76470: perf: cut per-walk work in the interpreter without adding any up-front schema
  analysis, so the cold one-shot path (this package's design target) gets faster
  rather than paying an amortized compile cost.

  - Dispatch the type-specific keyword blocks on the _value's_ type. A value is
    only ever one of object / array / string / number and each block is inert for
    the others, so the walk now runs the at-most-one block that can do work
    instead of calling all four and letting three early-return.
  - Avoid wrapping a single `type` keyword in a throwaway one-element array on
    every typed node, and build the `enum` mismatch label only on failure rather
    than allocating it (a `map`/`join`) on every successful check.
  - Memoize the allocation-heavy parts of an object schema node (its property
    keys, the `required` membership set, and the compiled `patternProperties`
    entries) keyed on the node, so they are built once instead of on every
    validation. This is done only for object nodes (few in number) and lazily, so
    the cold one-shot path pays at most a handful of small allocations — and an
    object node revisited within a single walk (an array of objects, a recursive
    `$ref`) rebuilds none of it, which speeds up the cold path too.

  Measured on `bun run bench`: steady-state throughput is ~2–3.4× the previous
  baseline (the reuse-heavy path that matters for long-lived consumers such as a
  linter), and the cold one-shot path is also faster across the board (e.g. the
  deep `$ref` schema roughly halved). Behaviour is unchanged — all unit tests and
  the ~144k-value differential fuzz against Ajv still pass.

## 0.6.1

### Patch Changes

- 23660c7: Allocate the regex and `$ref` caches lazily. A validator now defers building
  either `Map` until the schema first hits a `pattern`/`patternProperties` or a
  `$ref`/`$dynamicRef`, so the first validation of the common schema that has
  neither allocates 1 `Map` instead of 3. Schemas that do use those keywords
  build the same caches on first use, with no change in behavior.
- 78346bd: Speed up guard-mode interpretation. `validateGuard` no longer builds instance
  path strings while walking (they are only read in error mode), and object
  validation avoids redundant `Set` allocations per node. Roughly doubles
  guard-mode throughput on typical object schemas with no behavior change.

## 0.6.0

### Minor Changes

- bf002bb: Add `assert(schema, value, options?)`, a one-shot validate-or-throw helper that returns the value typed to the schema or throws a `ValidationFailedError` carrying the collected errors. Exposes the `ValidationFailedError` type alongside it.

## 0.5.0

### Minor Changes

- 4431f2d: Support the draft-04 boolean form of `exclusiveMinimum`/`exclusiveMaximum` (a
  boolean modifier on `minimum`/`maximum`) alongside the numeric 2020-12 form, and
  add the `regex` string format, which compiles the value to confirm it is a valid
  regular expression rather than pattern-matching it.
- 4cbcc65: Add the `FromSchema` type helper, which infers the TypeScript type of data a JSON
  Schema accepts when the schema is written `as const`. `validate` and
  `validateGuard` now infer their output type from the schema via a `const` type
  parameter, so guards narrow and validators carry their accepted type without a
  hand-written annotation; the new `Infer` helper recovers that type from a built
  validator or guard. Runtime-only keywords (lengths, patterns, numeric bounds) are
  correctly ignored, and `$ref`/`not`/`if`-`then`-`else` are skipped so the inferred
  type stays useful.

## 0.4.0

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

## 0.3.1

### Patch Changes

- 6218978: chore: version bumps

## 0.3.0

### Minor Changes

- 6fdb8bf: Support `$dynamicRef` / `$dynamicAnchor` (JSON Schema 2020-12). A `$dynamicRef`
  late-binds to the document's matching `$dynamicAnchor` — the pattern OpenAPI 3.1
  uses so a media-type `schema` can reference the root dialect. Resolution is
  document-global (one anchor per name, as in a bundled document) and is memoized
  per validator like static `$ref`s; a `$dynamicRef` written as a plain JSON
  Pointer falls back to static `$ref` semantics.

## 0.2.1

### Patch Changes

- 8cde234: Re-publish all packages.

## 0.2.0

### Minor Changes

- a3d7a41: Add `@amritk/runtime-validators`: an eval-free runtime JSON Schema validator for
  schemas you do not know ahead of time. It interprets the schema directly — no
  `new Function`, no code generation, no build step — so it has zero startup cost
  and runs anywhere `eval` is forbidden (strict CSP, Cloudflare Workers, React
  Native/Hermes). Two entry points: `validateGuard` (a zero-allocation boolean type
  guard that short-circuits on the first failure) and `validate` (collects every
  error with a JSON Pointer path). OpenAPI 3.0's `nullable: true` is honored — a
  `null` value is accepted regardless of the declared `type`. It is tuned for the
  cold one-shot path (validate a few values per schema), where it beats Ajv's
  compile-then-validate by ~90–1600×; for one-schema-many-values throughput, a
  compiling validator like Ajv or this repo's build-time `@amritk/generate-validators`
  is the right tool. Parity with Ajv is enforced by a differential fuzz test
  (~144k random/mutated values, zero divergences).
