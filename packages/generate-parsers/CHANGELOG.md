# @amritk/generate-parsers

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
