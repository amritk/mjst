# @amritk/generate-examples

## 0.8.0

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

- Updated dependencies [5e45680]
- Updated dependencies [69fa1f6]
  - @amritk/runtime-validators@0.12.1
  - @amritk/helpers@0.17.0

## 0.7.0

### Minor Changes

- cb7b35a: Fix several ways a generated example file could fail to compile, and bound the
  generator's work on hostile schemas.

  - A `$ref` inside `contains` or `dependentSchemas` was emitted as a bare
    `FooArbitrary` identifier with no matching import, so the generated file did
    not compile. The import collector now walks both surfaces.
  - An example carrying a key its generated type never declares — `required`
    naming something absent from `properties`, a `dependentRequired` /
    `dependentSchemas` dependency, a `minProperties` filler on an object with no
    index signature — was an excess property TypeScript rejected. The key stays
    (dropping it would ship a fixture missing what its schema demands) and the
    literal is now emitted as `… as Foo`.
  - An integer `multipleOf` was enforced with `.filter((n) => n % m === 0)`, which
    starved fast-check for anything but the smallest steps and rejected _every_
    value when `m` was `0` (`n % 0` is `NaN`). Positive integral steps are now
    derived analytically, as the `number` path already did; a non-positive one is
    dropped.
  - A crossed range (`minLength: 10, maxLength: 2`, and the equivalents for
    numbers, arrays, and dictionaries) was emitted verbatim, and every bounded
    `fc.*` combinator asserts `min <= max` — so the generated module threw at
    import, taking its other exports with it. Crossed bounds now collapse.
  - A large `minProperties` cost quadratic time and memory (synthesized key names
    grew with the key count), and a large `minLength`/`minItems` was honoured
    literally. Derived values are now capped at 10,000 characters / elements /
    keys, with the usual warning; the arbitrary still honours the real bound.
  - The runtime-validator import was decided by searching the generated source for
    the validator's name, which a schema could plant in its own data — earning an
    import nothing uses, which a consumer's `noUnusedLocals` rejects.

- 53651a1: Closes out the generated-file compile failures: a sweep of all 982
  `components.schemas` entries in the vendored OpenAPI corpus now type-checks with
  **0 failures** against the real `fast-check` declarations under the repo's strict
  flags, down from 13% at the start of the review and 2.33% one round ago. That
  sweep is now a test, so the number cannot drift back silently.

  Fixes, all reproduced against the corpus or a schema reduced from it:

  - **`oneOf`/`anyOf` replaced the node's own keywords instead of constraining them
    alongside.** `{ type: 'object', properties: …, anyOf: [{ required: … }] }` read
    the branch alone and answered `null` / `fc.anything()` against an object type.
    The node's own shape is now merged into each branch, and a branch whose `type`
    contradicts the node is dropped rather than re-admitting a value the type
    excludes.
  - **`mergeAllOf` silently dropped a nested `allOf`.** A `oneOf` branch written as
    `{ title: 'Token Usage', allOf: [{ properties: … }] }` — the shape OpenAPI
    documents use for discriminated unions — merged down to just its `title`, so
    the whole variant's properties vanished and the example came out `{}`.
  - **Object-likeness disagreed with the type generator.** It calls a schema an
    object on the _presence_ of `patternProperties`/`additionalProperties`, and on
    `properties` whatever `type` says; this package tested the value's shape and
    dispatched on `type` first. Both now match it exactly.
  - **`if`/`then`-only objects** get an assertion: the type generator folds the
    branch's properties in as required, and nothing structural tells the deriver to
    produce them.
  - **An unresolvable `$ref` is no longer named by the arbitrary**, since the import
    collector deliberately skips it.
  - **A `false` schema** types as `never`, which nothing is assignable to; both the
    arbitrary and the example now say so explicitly.
  - **An exclusive bound equal to its opposite** (`exclusiveMinimum: 5, maximum: 5`)
    emptied the range `fc.double` had to draw from.
  - **`k * multipleOf`** could exceed `fc.integer`'s inclusive 32-bit maximum by one.
  - **`uniqueItems` with a closed `contains`** could not reach the required length
    and retried forever; elements now widen to "that value, or anything", which is
    the freedom the schema actually grants.
  - **The runtime-validator import** was decided by a weaker condition than the one
    that emits the validator, so a schema the interpreter refuses earned an import
    nothing used.

- 1e77678: A round of fixes for generated files that did not compile, threw at import, or
  hung when sampled. Measured against a real OpenAPI corpus, 13% of schemas
  produced a file that failed to type-check before these.

  **Files that did not compile**

  - The validating filter's type guard (`(value): value is T`) requires the
    declared type to extend what the base expression infers, but a filtered
    arbitrary deliberately builds a _different_ shape — `contains` generates
    `number[]` for a declared `unknown[]`, `dependentRequired` promotes an optional
    key to required, `dependentSchemas` adds one the type never declared. Each
    raised TS2677. The base is now widened to `Arbitrary<unknown>` first.
  - A schema with `properties` and no `type: object` — ordinary in OpenAPI — got a
    type of `{ … }` but an arbitrary of `fc.anything()` and an example of `null`.
    Both now infer the object shape the same way the type generator does.
  - A recursive definition's example cuts the cycle with `null`, which its
    non-nullable type rejects. It is now emitted with an assertion.
  - `contains` alongside `items` put a `contains`-typed value into an
    `items`-typed array. `items` constrains every element, so a `contains` value is
    used only when `items` accepts it too.
  - A non-finite `multipleOf` derived `NaN`, which serialized as `null`.
  - A non-string `required` entry reached the emitted `requiredKeys`.

  **Modules that threw at import, or hung when sampled**

  - An uncompilable `pattern` (`"["`) or one using a lookahead/lookbehind made
    `fc.stringMatching` throw — at import for the first, at sample time for the
    second — taking every export in the file with it. Both now fall back to
    `fc.string()`. The embedded runtime validator is likewise only emitted when it
    can actually be built.
  - An integer bound beyond fast-check's 32-bit range left it with a minimum above
    its own maximum, and threw. Bounds are now confined to that range.
  - `uniqueItems` over a closed value set (`items: { type: 'boolean' }`,
    `minItems: 5`) asked for more distinct values than exist, and fast-check
    retries forever. The length is now capped at the size of the set.

  **Crashes and resource use**

  - A property named `__proto__` under any `allOf` threw
    `TypeError: bucket.push is not a function` out of the whole generation run:
    `mergeAllOf` read its accumulator with a bare index, which answers
    `Object.prototype` for that key. Its accumulators are now null-prototype.
  - A deeply nested document died with a bare `RangeError` from whichever helper
    was deepest. The three recursions here now refuse past 400 levels with a
    message naming the limit.

### Patch Changes

- 4d5f1bb: The ReDoS screen now admits separator-delimited repetitions it used to reject.

  **What changes for you:** a `pattern` of the shape `(<sep><body>)*` or
  `(<body><sep>)*` — a dotted identifier chain, a slash-delimited pointer, a
  comma-separated list — is no longer refused as "nested unbounded quantifiers".
  Schemas that previously threw at `validate()` time, or needed
  `limits: { allowUnsafePatterns: true }`, now build. That part is one-directional:
  across 1.5 million generated patterns the exemption never turned an accepted
  pattern into a rejected one.

  **One such loop per concatenation.** Two of them side by side keep being refused,
  because two nullable loops compose — see below — and the rule does not try to work
  out whether a particular pair can. So `^\d+(\.\d+)*$` builds where it used to
  throw, while `^\d+(\.\d+)*(-[a-z]+)*$` still throws, even though its two loops
  have disjoint separators and it is in fact linear. Both were refused before this
  release, so nothing regresses; but if you were hoping a semver or host-and-port
  pattern would start building, it will not. `allowUnsafePatterns` remains the
  escape hatch, and a rule that proved the two loops' alphabets disjoint would be
  the way to lift it.

  **Two parser fixes ride along, and they do newly reject a narrow set.** Both were
  pre-existing bugs that let a genuinely exponential pattern through:

  - The class scanner applied the POSIX "a leading `]` is a literal member" rule,
    which ECMAScript does not have — `[]` is the empty class and `[^]` is any
    character. A `[^]` therefore swallowed the rest of the pattern into one atom
    and hid whatever followed: `^[^]*(a+)+$` contains a textbook `(a+)+` and was
    accepted, at 4 seconds on 28 characters.
  - A braced escape (`\u{61}`, `\p{L}`) was read as two code units, leaving `{61}`
    to be taken for a bounded quantifier that then swallowed the real `+` — so
    `^(\u{61}+)+$`, which _is_ `^(a+)+$`, lost a level of star height. Its payload
    is now validated as it is scanned, since a span the escape cannot legally
    carry is not an escape under either compile mode: `\p{(a+)+}` is a
    `SyntaxError` with `u`, so the fallback compile runs the `(a+)+` inside it.

  Most of what these newly reject is genuinely unsafe, but not all of it: rule 1 is
  an over-approximation, and a braced escape in atom position now costs the
  anchored exemption even where the same pattern spelled in ASCII keeps it — so
  `^(\u{61}+x)+$` is refused while `^(a+x)+$`, which it is identical to, is
  admitted. Both are linear; the refusal is a false positive, in the safe
  direction. Ordinary standalone uses (`\u{61}+`, `\p{Script=Latin}+`,
  `[\u{61}-\u{7A}]+`, `[^]*`) keep their previous verdicts.

  `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$` and
  `^\$message\.(header|payload)#(\/(([^\/~])|(~[01]))*)*` — both from the official
  AsyncAPI meta-schemas — are the motivating cases. Star height alone called them
  catastrophic; on V8 they match a failing 30-character input in under 0.05 ms.

  **Why it is sound.** Star height >= 2 is still the rule; a repetition is now
  exempt from _counting toward_ it when two things hold together. First, the body
  carries a literal character at a fixed end that no other atom in it can produce,
  so the positions of that character are the word boundaries and no input can be
  split two ways. Second, the body derives each word exactly once — checked over a
  deliberately small grammar (no `?`, no `{n,m}`, a repeated atom may not run into
  what follows it, a trailing alternation must be settled by its first character).

  The waived level comes back whenever something can compose the exempted loop with
  itself. What the exemption establishes holds for one pass; `(BODY)*` still matches
  the empty string however unambiguous BODY is. A quantifier around it composes
  those matches — a _bounded_ one too, which is the case that looks harmless, and
  `^((-a*)*){0,50}$` is 2^n. So does simply writing the loop twice in a row:
  nothing pins which copy owns which word, and `^(-a*)*(-a*)*…$` with eight of them
  is degree-8 polynomial, 5.6 seconds on 43 characters. One loop is the case the
  exemption is for; two is where it stops holding.

  The second condition is the one that is easy to miss, and omitting it is not
  safe: a backtracking engine explores derivations, not splits, so a body that
  matches its own substring k ways costs k^n over n repetitions even with every
  boundary pinned. `^(\.((\w[a-z]?|b\w+)?|(a*[a-z0-9]?)?))*$` is separator-anchored
  and takes 94 ms on 22 characters where its body alone takes none.
  `^([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$` — genuinely exponential,
  8.9 seconds on 30 characters — is still refused, as is every classic shape
  (`(a+)+`, `(a*)*`, `(a|a)+`).

  The screen remains a best-effort filter rather than a proof of safety, with the
  same known gaps. The new analysis is capped by its own shared budget, charged by
  span for every character it examines and every character-class comparison it
  makes, and its cost against a hostile source plateaus around 15 ms. That is
  not a claim about the screen as a whole: the pre-existing ambiguous-alternation
  rule spends its budget per branch
  pair while each comparison may compile a character class, so a 176 KB alternation
  of literals and long classes costs ~200 ms to screen. Unchanged here, and
  unchanged by this release.

  `@amritk/generate-examples` only retargets a test fixture that had used
  `^(repeat+)+once$` to stand for a refused pattern — that one is admitted now,
  and measures linear.

- 6771a4f: Degenerate keywords no longer produce an arbitrary that throws at import.

  - An empty `oneOf`, `anyOf`, `enum`, or `type: []` emitted `fc.oneof()` /
    `fc.constantFrom()` with no arguments, and both throw. They now degrade to
    `fc.anything()`, as every other keyword this generator cannot honour does. A
    single-branch choice is emitted directly instead of being wrapped.
  - A fractional or negative length/count bound (`minItems: 1.5`,
    `maxLength: -5`) was passed straight to fast-check, which requires a
    non-negative integer and throws otherwise. Each bound now rounds toward the
    satisfiable side and floors at zero.

- c90143f: Two more ways a generated file could fail to compile or throw at import.

  - A non-finite numeric bound was emitted verbatim. `1e999` is legal JSON and
    `JSON.parse` turns it into `Infinity`, which the numeric keyword guards accept
    — so `{ minimum: 1e999 }` produced `fc.double({ …, min: Infinity })`, and every
    bounded `fc.*` combinator throws on that the moment the module is imported.
    Non-finite bounds (and a non-finite or non-positive `multipleOf`) are now
    treated as absent.
  - An authored `default` / `examples[0]` was emitted verbatim even when it
    contradicted its own schema. The generated type follows the schema, not the
    hint, so `{ type: 'string', default: 42 }` produced
    `const fooExample: string = 42`. A hint is now used only when it validates;
    otherwise the value is derived structurally. `const` is unaffected — the type
    is the const's own literal type, so the two cannot disagree.

- Updated dependencies [4d5f1bb]
- Updated dependencies [0f27eeb]
- Updated dependencies [1c328af]
- Updated dependencies [1fd154c]
- Updated dependencies [3557eb5]
- Updated dependencies [11a280f]
- Updated dependencies [e091f22]
- Updated dependencies [2162f87]
- Updated dependencies [3a54baf]
- Updated dependencies [543fbe8]
- Updated dependencies [c6a1f16]
- Updated dependencies [261f650]
- Updated dependencies [dcfe9a9]
  - @amritk/runtime-validators@0.12.0
  - @amritk/helpers@0.16.0

## 0.6.4

### Patch Changes

- 34c5eaf: Do not let a bad `format` or `pattern` break the run.

  `deriveExample` compiled `schema.pattern` unguarded to check a sampled
  candidate, so a schema carrying a pattern that is not a valid JavaScript regex
  (`*bad`, `a{2,1}`, a duplicate named group) threw a bare `SyntaxError` out of
  the generator. An uncompilable pattern now reads as unsatisfied and the
  fallback string is emitted — the choice the `patternProperties` compile in the
  same file already made.

  The format-example table was indexed directly, so `format: "valueOf"` resolved
  to a `Function` rather than a string and the emitted `fooExample` carried
  `undefined` for that property — a generated file that does not type-check.

  `needsValidationFilter` classified keys by name alone, so a schema whose hard
  keyword sat under a property named `example` or `default` was reported as
  needing no filter — and the generator emitted a derived example without
  checking it, so it could ship one the schema rejects. It is position-aware now,
  like the walkers in `@amritk/helpers`.

- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
  - @amritk/helpers@0.15.4
  - @amritk/runtime-validators@0.11.0

## 0.6.3

### Patch Changes

- Updated dependencies [36f03a2]
  - @amritk/helpers@0.15.3
  - @amritk/runtime-validators@0.10.1

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
