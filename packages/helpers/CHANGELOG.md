# @amritk/helpers

## 0.18.0

### Minor Changes

- 049b0e9: Give the numeric bound keywords one home, and pin the generated parsers to the
  interpreter's verdict.

  `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` have exactly one
  rule that is easy to get wrong: a bound must be spelled as the _pass_ condition
  and negated (`!(x >= min)`), never as a failure condition directly (`x < min`).
  The two are identical for every ordinary number and opposite for `NaN`, which
  compares `false` against every relational operator — so the direct form silently
  _accepts_ a `NaN` the interpreter and Ajv both reject. `@amritk/generate-
validators` drifted on precisely this once already.

  The rule now lives in `@amritk/helpers/numeric-bound-check`, next to
  `multiple-of-check`, and the four emitters that restated it —
  `generate-validator-function` (both its error-collecting and guard forms),
  `generate-schema-checks`, and `generate-strict-assertion` — call it instead.
  Emitted output is unchanged apart from parentheses.

  `@amritk/generate-parsers` also gains an `interpreter-parity.test.ts`, the
  coverage gap that let the drift happen in the first place: its differential
  suites fuzz against Ajv over inputs built from the schema, and those inputs are
  JSON, which cannot hold a `NaN`, an `±Infinity`, or a value large enough to
  overflow a `multipleOf` quotient. The new test runs the generated strict parser
  and the runtime interpreter over exactly those values and requires the same
  verdict.

## 0.17.0

### Minor Changes

- 69fa1f6: Cut the hot-path cost of generated parsers and of every barrel a CommonJS
  consumer calls through.

  - **Strip builds no longer prove "no undeclared key" before their fast path.**
    A strip build returns a literal naming only the declared properties, so an
    extra is dropped by construction and proving its absence first bought nothing.
    Parsers that must _reject_ an extra keep the proof. **This is an observable
    change:** a stripping parser used to hand a clean nested object or array
    element back by reference, so `parse(x).nested === x.nested`; it is now always
    a fresh object. For a parser whose job is to strip, that is the safer default —
    a caller mutating the result can no longer reach the input.
  - **A single-use nested sub-parser's fast path is inlined at its one call
    site,** with the call kept for everything it does not cover. The expansion is
    one level deep by construction and capped per parser.
  - **Generated `index.ts` barrels re-export values as `const` aliases.**
    TypeScript lowers `export { x } from './x.js'` to a CommonJS _accessor_, so a
    CJS consumer paid a property getter on every call through the barrel; the alias
    form lowers to a plain data property. Types keep the `export type { … } from`
    form. Both forms tree-shake identically in esbuild and rollup.

  Measured on Node 22 with `benny`, one variant per process, median of five, on
  the `typescript-runtime-type-benchmarks` payload and its four cases, with each
  result consumed so nothing is eliminated as dead. Reached through the generated
  barrel, compiled with `--module commonjs`:

  | case           | before |  after |       |
  | -------------- | -----: | -----: | ----: |
  | `parseSafe`    |  27.9M |  44.0M | 1.58x |
  | `parseStrict`  |  22.8M |  27.8M | 1.22x |
  | `assertLoose`  |  57.0M | 134.8M | 2.36x |
  | `assertStrict` |  32.3M |  43.8M | 1.36x |

  Importing the module directly under ESM, where only the parser changes apply,
  `parseSafe` goes 34.1M → 41.4M (1.21x) and the other three are unchanged.

  Absolute figures are machine-specific and two ceilings bound them: an empty
  benchmark case measures ~115M ops/s here, so `assertLoose` is already reporting
  the harness rather than the validator; and a parse whose result is discarded (as
  the harness discards it) has its allocation scalar-replaced, which flatters every
  `parse*` number. Forcing the result to escape, `parseSafe` reads 30.8M → 37.2M
  against 50.2M for a hand-written parser — 61% of hand-written before, 74% after.

### Patch Changes

- 5e45680: Specialize each schema node into a closure on first visit, instead of re-walking
  the schema on every call.

  The interpreter rediscovered the same things for every value it validated: which
  keywords a node carried (a `WeakMap` lookup per node), its property key list, its
  `required` membership, its compiled `pattern`s, and which of the type-specific
  keyword blocks could possibly do work. None of that depends on the value — it is
  a pure function of the schema node — so a CPU profile of the steady-state
  benchmark spent essentially all of its time in dispatch rather than in checks.

  Now a node is turned into a step closure the first time a validation reaches it,
  with all of that already resolved and closed over, and the node's record is
  patched so later calls go straight to it. Validating is then nested closure
  calls with the traversal, the keyword dispatch and the metadata lookups gone.
  Steady-state throughput is up **27–179%** across the bench suite (the biggest
  win on the `moltar/typescript-runtime-type-benchmarks` shape now in `bench/`,
  where guard throughput more than doubles), and the `@amritk/api` request path
  gains 5–11% where validation is on the critical path.

  This is still an eval-free interpreter — no `new Function`, no code generation,
  no build step — so it runs unchanged under a strict CSP, on Cloudflare Workers,
  and on React Native/Hermes. The specialized form is a tree of ordinary closures.
  Closing the rest of the gap to generated code is not something closures can do:
  what makes `@amritk/generate-validators` fast is a single inlined function body,
  and an indirect call per node is the floor for anything that does not emit one.

  Nothing observable changes. Error messages, JSON Pointer paths, the `maxSteps` /
  `maxDepth` accounting, the ReDoS pattern screen, and `$ref` / `$dynamicRef` /
  `$recursiveRef` resolution — including the dynamic scope, which stays a runtime
  parameter because that is exactly what `$dynamicRef` late-binds against — are all
  preserved as they were. The full JSON Schema Test Suite and the Ajv differential
  fuzz stay green.

  Building is deferred to a node's first visit rather than done up front, so
  `validate(schema)` still returns without reading the schema, an unresolvable
  `$ref` still throws on use rather than on construction, and a one-shot check
  never pays for `$defs` its data does not reach. That deferral runs deeper than
  the node: a node's type-specific block is built only once a value of that type
  gets past the type check, and a `properties` entry only once a value reaches it.
  A `{ type: 'object', properties: … }` node meeting a string or `null` — most of
  what a union throws at it — now costs a type test and nothing else.

  Cold cost still moves, because a node's step is a few closures where its
  metadata was one object, and how much depends entirely on how much of the schema
  the data touches. Measured over the vendored OpenAPI corpus (982 real component
  schemas, each prepared and used once) it is **~6% slower on average**, and a
  `$ref`-heavy schema is _faster_ cold, because a target is specialized once and
  reused across every array element rather than re-walked. The worst case is a
  schema whose data reaches everything it declares — the 40-property bench case,
  validated once against an instance carrying all forty — which stays around twice
  its old cold cost, against Ajv's ~11 ms to compile the same schema. There is no
  way around that one: specializing a node is the cost, and that case specializes
  all of it and then uses each step once.

  The published performance table was re-measured for this change, but on Bun
  1.3.11 rather than the Bun 1.4 the repo's other tables use; its caption says so,
  and it is worth re-running at release time.

  `@amritk/helpers` is here only because three of its comments name the
  interpreter file that this change renames; nothing it emits changes.

## 0.16.0

### Minor Changes

- 1c328af: `escapeRegexPattern` rejected patterns that are legal in Unicode mode.

  Its validating `new RegExp(pattern)` omitted the `u` flag, while `regexFlagsFor`
  adds that flag whenever the pattern compiles with it. A pattern that is legal
  _only_ in Unicode mode — an astral range like `[😀-😜]`, or `[\u{61}-\u{7A}]` —
  therefore failed generation with "Invalid regex pattern", even though the
  emitter would have given it the `u` flag that makes it legal, and even though
  Ajv (the differential oracle this package tracks) accepts it.

  Both functions now read one cached compile decision: `u` where the pattern is a
  legal Unicode-mode regex, no flag where it is legal only without one, and an
  error only where it is a regex in neither mode. A pattern that is legal only
  without the flag (`\-`, a bare `\p`) is unaffected.

- 11a280f: Fix five correctness and robustness defects found in a review of the package.

  - `resolveDynamicRefs` skipped the whole document when its only `$dynamicRef`
    sat under a property genuinely _named_ `enum`, `const`, `default`, `example`
    or `examples`. The cheap pre-scan that decides whether to rewrite at all
    tested key names without tracking whether it was inside a name-to-schema map,
    so the ref survived into generation — where the type generator names the type
    after the anchor and, for the conventional anchor `node`, silently binds to
    the DOM's `Node` interface. The pre-scan now asks the same shared position
    rule the rewrite does.

  - `generateTypeDefinition` and `mjst-extension` read schema keywords straight
    off the node, so a polluted `Object.prototype` was indistinguishable from an
    authored keyword: with `Object.prototype.additionalProperties` set, a bare
    `{ type: 'string' }` rendered as `{ [key: string]: number }`, and an inherited
    `if`/`then` pair recursed until the stack ran out. Both now read own
    properties only, matching what `schema-guards` already does for the keywords
    it guards.

  - `graftExternalSchemas` and `pruneExternalSchemas` rebuilt `$defs` with plain
    assignment, so a definition named `__proto__` — including one the author
    wrote, and one derived from a registered URI ending in `__proto__.json` —
    ran the prototype setter instead of becoming a property: the definition
    disappeared while every reference to it stayed, and the map inherited the
    definition's own keywords. Both now use the package's `assignKey`.

  - Six recursive walkers had no depth guard, so a pathologically nested document
    died with a bare `RangeError` instead of the message `MAX_SCHEMA_DEPTH`
    exists to produce — including on `walkRefGraph`, the package's main entry
    point. `assertSchemaDepth` now takes an optional limit, and the type renderer
    passes a lower one: it spends about five stack frames per schema level where
    the document walkers spend one, so at the shared cap the stack ran out first
    and the guard could never fire. Documents nesting deeper than 400 levels are
    now reported by name rather than crashing.

  - `walkRefGraph` generated an output file for a definition referenced only from
    a `default` value, because the `$dynamicRef` pointer scan walked instance
    data. It now skips data positions, as its sibling scans already did.

  Also: the `minLength: 1` fast paths in `string-length-check` are now
  self-parenthesized, so every emitted expression can be negated with a bare `!`
  the way `multiple-of-check` documents (`!x.length >= 1` parsed as
  `(!x.length) >= 1` — a constant `false` that passed every string).

- e091f22: `deriveRootTypeName` mangled non-ASCII titles. It split words on
  `[^a-zA-Z0-9]+`, which is the ASCII-only class `ref-to-name` documents having
  fixed for `$ref`-derived names — so a document titled `中文` or `Приложение`
  reduced to nothing and was named `Document`, `Café Menu` came back as
  `CafMenu` with the `é` deleted from the middle of a word, and `Ünïcödé Doc` as
  `NCDDoc`. A `$ref` to a definition of the same name was spelled correctly, so
  the root type and the refs into it disagreed. Both now go through one shared
  `toPascalWords`, so they cannot drift again. Leading digits are still dropped
  from a title (`3 amigos` → `Amigos`), which is where the two policies
  legitimately differ.

  `isDraft07Schema`, `hoistNestedDefs` and `deriveRootTypeName` also read
  `$schema`, `$defs` and `title` straight off the object, so a polluted
  `Object.prototype` was indistinguishable from a declared keyword — an inherited
  `$schema` put every document through the draft-07 rewrite. All three now read
  own properties only.

- 3a54baf: `unknownKeyCheck`'s `isUnknown` / `isKnown` now return self-parenthesized
  expressions, matching what `multiple-of-check` and `string-length-check`
  already promise.

  The two forms were not interchangeable: above `INLINE_KEY_LIMIT` the result is
  an atomic `set.has(k)`, below it a bare `a || b`. A caller writing
  `x && check.isKnown(k)` therefore got `(x && a) || b` for a 16-key object and
  correct code for a 17-key one — a precedence bug that appears and disappears
  with a performance threshold rather than with anything the caller wrote.
  Generated sweeps gain one pair of parentheses; nothing they mean changes.

- 261f650: `quoteJsString` and `escapeRegexPattern` lost unpaired surrogates.

  A lone surrogate is a legal JSON string (`"\ud800"`), so it is a legal property
  name, `pattern`, or enum member — but it has no UTF-8 encoding. Both helpers
  passed one through raw, and writing the generated file replaced it with U+FFFD:
  the string literal on disk was a _different string_ than the schema declared, so
  the emitted check rejected a value the document says is valid, and an emitted
  regex matched a different character than its author wrote. Both now escape an
  unpaired surrogate (`\ud800`, matching the identical character). A well-formed
  surrogate pair encodes fine and stays on the fast path, so emoji in a property
  name cost nothing.

### Patch Changes

- 1fd154c: Fix five shape combinations where the generated TypeScript did not compile.

  Found by a new fuzz suite that type-checks _fuzzed_ documents — `$defs`, `$ref`s,
  embedded helpers and the index barrel compiled as one program, the way a consumer
  compiles them — across every option the generator exposes. The existing
  `generated-code-types` corpus is hand-picked, and none of these shapes were in it.

  Four of the five have one cause: an expression TypeScript cannot narrow, read
  twice. A property named after an `Object.prototype` member is read through a
  conditional (`Object.hasOwn(input, "constructor") ? … : undefined`), so
  `Array.isArray(<expr>) && <expr>.length` reported "Object is of type 'unknown'";
  the subschema matcher's record view (`x as Record<string, unknown>`) and its
  tuple-element view (`x as unknown[]`) are cast expressions with the same problem.
  Each now carries a type the repeated read can use — nothing real is given up,
  since the value behind it genuinely is unknown and every read sits inside a
  runtime guard that tests it. The `.every` callbacks that hang off those accessors
  carry an explicit parameter type, so they cannot come out implicitly `any`.

  The fast path's object literal was asserted with a plain `as T`. That looked
  checkable and was not: `_x !== undefined` narrows an `unknown` read to
  `{} | null`, which TypeScript then refuses to convert to a `$ref` type, and
  `Array.isArray(_x)` narrows it to `any[]`, which it refuses to convert to a
  tuple. It is `as unknown as T` now — the guard above it is what proves the shape.

  Finally, the non-object fallback literal is asserted whenever a prototype-member
  name appears anywhere in the subtree it builds, not only at the top level: a
  nested `{ "0": "" }` against an item type declaring `constructor?: true` carries
  an inherited `constructor: Function` that does not assign. The assertion is
  `as unknown as T` for the same index-signature reason.

- 3557eb5: Treat a non-map `properties` / `patternProperties` as absent instead of crashing.

  `typeof null === 'object'`, so a document carrying `{"patternProperties": null}`
  slipped past the `!== undefined` check and reached `Object.keys(null)` — which
  throws a `TypeError` and took the whole generation run down with it, rather than
  producing a type for the one bad schema. Schemas come from the caller and
  malformed ones are ordinary input, so a keyword whose value is not a map of
  names to schemas is now read as absent. The same applies to a `null`
  `additionalProperties`, which previously counted as present and was rendered as
  an index signature's value type.

- 543fbe8: Read every schema keyword as the node's own property.

  The generators asked `'items' in schema` and read `schema.type` straight off the
  node, and both walk the prototype chain. With `Object.prototype.items` set — by a
  dependency with a prototype-pollution bug, or simply by a schema built over a base
  object — every node in the document answered "yes" to keywords none of them
  declared, and the result was a _different validator_: an inherited `items: false`
  made every array have to be empty, an inherited `patternProperties` swallowed the
  `additionalProperties` sweep so unknown keys stopped being reported, and an
  inherited `if`/`then`, `allOf` or `contains` sent a walker into unbounded
  recursion, so `buildValidatorSchema` threw a `RangeError` instead of generating.

  `@amritk/helpers/own-keyword` is the shared reader — the question
  `@amritk/helpers/schema-guards` and `@amritk/runtime-validators` already ask, for
  the keywords with no named guard. Generated output is unchanged for every schema
  in the conformance corpus and the vendored OpenAPI fixtures.

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

## 0.15.4

### Patch Changes

- 34c5eaf: Stop the schema walkers from losing keys, rewriting instance data, and
  disagreeing with each other.

  **A property named `__proto__` no longer disappears.** Every walker here
  rebuilds objects key by key, and on that one key `result[key] = value` is not
  an assignment — it runs the prototype setter, so a declared property and all
  its constraints vanished from the output while the rebuilt object started
  inheriting the subschema's keys. The guard existed in one place; it is now a
  shared `assignKey` used by every walker, and `foldNullable` no longer sweeps
  with `for…in` either. In the draft-07 upgrade the same slip lost a _definition_
  named `__proto__` while still rewriting the `$ref` to it, so the ref dangled
  and the generators stopped the build.

  **A definition or property named `default`, `example` or `examples` is a name,
  not a keyword.** Every walker tested the data keywords by key name alone, which
  conflated a schema node (where those are keywords holding instance data) with a
  `properties`/`$defs`/`dependencies` map (where they are author-chosen names).
  So an `$anchor` declared under `$defs.default` never registered and `$ref:
'#thing'` could not resolve; a `#/definitions/…` under a property named
  `example` was left dangling; a schema-shaped `default` had its `nullable`
  folded and a ref-shaped one had its literal rewritten; and a boolean inside a
  `default` was expanded from `true` to `{}`. Two shared predicates — `isDataPosition` and
  `entersSchemaMap` — now answer that question, and all eight walkers ask
  them, including about the array rule they had split on.

  **Type guards ask `Object.hasOwn`, not `'key' in schema`.** All thirty-five
  guards in `schema-guards` probed with `in`, which walks the prototype chain —
  so with `Object.prototype.properties` set by any dependency, `hasProperties`
  answered true for a schema that has none and the generators emitted types,
  parsers and imports for a definition nobody declared. Fixing it in the guards
  fixes it for every consumer at once.

  **Reference and anchor reads are own-property reads.** The guards were fixed
  but the keyword reads inside the walkers were not, so an inherited `$ref`,
  `$anchor`, `$dynamicRef` or `$dynamicAnchor` still read as declared: with
  `Object.prototype.$dynamicRef` set, `resolveDynamicRefs` threw "Unresolvable
  $dynamicRef" on a document containing none; with `Object.prototype.$anchor`,
`buildAnchorMap`registered a phantom anchor at the root and`$ref: '#ghost'`
  resolved to the root schema instead of failing; with `Object.prototype.$ref`,
`assertIdScopes`failed the build on a valid document.`validateRecord`— which
is copied into generated output and runs on untrusted input — swept with`for…in`, so a parsed record came back carrying properties the input never had.

  **A ref-shaped value inside a data keyword stays a value.** `extractRefs`
  collected `$ref`s out of `default`/`enum`/`example(s)`, so `walkRefGraph`
  failed the build when the literal named nothing and emitted a spurious file
  when it did; `resolveDynamicRefs` rewrote such a literal (key deleted, `$ref`
  added) or threw on an unmatched one; `rewriteRefs` rewrote it during the
  draft-07 upgrade, which for an `enum` member means an instance equal to a
  declared member is then rejected; and `referencesRoot` counted a
  `default: { "$ref": "#" }` as a real root reference, grafting a full self-copy
  of the document into `$defs`. `data-position.test.ts` now runs every walker
  against every data keyword.

  **Lookups no longer resolve against `Object.prototype`.** `resolveRef` returned
  `Object.prototype` for `__proto__` as though the document had declared it (and
  `walkRefGraph` emitted a file for it); `$dynamicRef: "toString"` resolved to a
  `Function` in place of the "unresolvable" error; `pruneExternalSchemas` read
  `$ref` unguarded, so a polluted prototype made everything read as reached and
  nothing was pruned.

  **Pointer escaping agrees end to end.** `buildAnchorMap` and
  `buildDynamicRefMap` each carried a private escaper that handled `~` and `/`
  but not `%`, while the pointers they produce are `$ref` fragments that
  `resolveRef` percent-decodes — so a definition named `a%2Fb` was looked up as
  `a/b`. Both use the registry's escaper now, and `unescapeSegment` reverses the
  `%` escape it adds. A parity test asserts the four hand-maintained copies of
  the keyword sets stay equal, since each had drifted at least once.

## 0.15.3

### Patch Changes

- 36f03a2: Review follow-ups to the sibling-composition fix: three symbols the generated
  output declared without reading, and a tuple type no validator would have held
  anyone to.

  ### Unused symbols in the emitted files

  All three are `noUnusedLocals` / `noUnusedParameters` errors in a consumer's
  build — flags this repo holds itself to and any consumer inherits — and all three
  were found by compiling the vendored OpenAPI corpus under them rather than
  reasoned about. Each is an ordinary shape, not a corner:

  - **`ValidationError` was imported by every generated file.** Only a body that
    _accumulates_ errors names the type; a validator whose whole answer is one
    inline `return { valid: false, errors: [ … ] }` never declares the array. That
    is every scalar root — `{ "type": "string" }`, the commonest schema an OpenAPI
    document has — plus a delegating `$ref`, a `const`, an `enum` and a boolean
    root. The import is now conditional, the same way the runtime helpers beside it
    already were.
  - **`const obj = input as Record<string, unknown>` was emitted by both flat
    guards regardless.** A node with no property to read guards on the shape alone
    and never touches the narrowing, so `{ "type": "object", "properties": {} }` —
    in `openai.yaml` today — declared it twice and read it neither time. The cold
    error-collecting body already had this liveness test; the exported validator's
    hot guard and `isX` now share it.

  ### A tuple type nothing enforced

  `getTuplePositions` took the positions from a _non-empty_ `prefixItems` and
  otherwise fell back to the draft-07 array `items`, so an empty `prefixItems`
  fell through to the array behind it: `{ "prefixItems": [], "items": [{"type":
"string"}] }` typed as `[string?, ...unknown[]]` while
  `@amritk/runtime-validators` and the generated validator both read the
  `prefixItems`, found no positions, and enforced nothing. A `prefixItems` that is
  merely present now takes the positions there too, which is what both runtimes
  already do, so the type says `unknown[]` — a widening rather than a claim. An
  empty _array_ `items` is unaffected: with no `prefixItems` to displace it, it is
  a draft-07 tuple of no positions whose every index answers to `additionalItems`,
  and the emitter validates it as such.

  ### Docs the audit invalidated

  The audit moved three JSON Schema Test Suite cases to passing, but the numbers
  quoted in prose did not move with them: the README still advertised **1271 /
  1281 (99.2%)** and enumerated ten failures including two `$id`-scoping cases that
  now pass. It is 1274 / 1281 (99.5%) and seven. `conformance.test.ts` now pins
  both totals, so the next gap that closes fails the build instead of leaving the
  package advertising a worse number than it delivers.

  The README and `AI.md` also still listed "a node under `additionalItems`" among
  the shapes where an `unevaluated*` refuses. That refusal is now limited to an
  _inert_ `additionalItems` — one with no array `items` to be the tail of, or with
  a `prefixItems` that took the positions out from under it.

## 0.15.2

### Patch Changes

- 2e3399a: Rewrite `#/definitions/...` refs written _outside_ the `definitions` block when
  upgrading a draft-07 document.

  `upgradeDraft07Schema` renames the root `definitions` to `$defs`, and rewrote the
  `$ref`s written inside that block to match — but the rest of the document was
  spread through verbatim, so an ordinary
  `{"properties": {"a": {"$ref": "#/definitions/thing"}}}` kept naming a block that
  no longer exists. Generation then stopped with `Could not resolve $ref
"#/definitions/thing"`, which made a common shape of draft-07 document
  ungeneratable. The same rename now applies to the whole document.

  Only the `$ref` strings are rewritten; a key spelled `definitions` outside the
  root block is left alone, since it is not hoisted and is not addressable as
  `#/$defs/...`. A pointer that dives through a _nested_ definitions block
  (`#/definitions/x/definitions/y`) still keeps its inner segment and does not
  resolve — unchanged, and the same limitation the in-block rewrite already had.

  Fixes generation for draft-07 documents in `@amritk/generate-parsers`,
  `@amritk/generate-validators` and `@amritk/generate-examples`, which all reach
  this through `@amritk/helpers/walk-ref-graph`.

## 0.15.1

### Patch Changes

- 4178e8d: Patch release across all packages.

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
