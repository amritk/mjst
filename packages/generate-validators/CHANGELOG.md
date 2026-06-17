# @amritk/generate-validators

## 0.11.0

### Minor Changes

- fadf545: Enforce the array and combinator keywords the generator previously parsed but
  ignored, proven against Ajv by the differential fuzz test:

  - Array: `minItems`, `maxItems`, `uniqueItems` (dedupes by a JSON projection —
    exact for primitives, the same projection the boolean guard uses),
    `contains` / `minContains` / `maxContains`, and tuple `prefixItems` with a
    length cap from `items: false` / `additionalItems: false`.
  - Combinators: `allOf` (conjunction, errors surfaced per branch), `anyOf`,
    `oneOf` (exactly one), `not`, and `if` / `then` / `else` — built on a shared
    "does this value match this subschema" boolean primitive — both as object
    properties and as a top-level schema.

  The generated `isX` type guard bails to the validator for schemas carrying any of
  these so it never disagrees with the slow path. Still out of scope: validating
  constraints on a top-level non-object schema (e.g. a root `{ type: 'array',
minItems }`), and `$ref` inside a `contains` / combinator branch in single-file
  output (it requires the referenced validator to be in scope).

- 26732dd: Generated validators now enforce several constraints they previously accepted
  silently, closing gaps a new Ajv differential fuzz test surfaced:

  - `patternProperties` values and a schema-form `additionalProperties` are now
    validated (previously only `additionalProperties: false` was enforced, so a
    value matching a pattern — or any extra key under an `additionalProperties`
    schema — passed unchecked).
  - `type: 'integer'` now rejects non-integral numbers, and `type: 'null'` is
    enforced, in both the validator and its boolean guard.
  - `required` keys with no `properties` entry now get a presence check.
  - `propertyNames` and `dependentRequired` are now enforced inside nested inline
    objects, not just at the root.

## 0.10.1

### Patch Changes

- 8a1a91e: perf: lazily allocate the validator's error array so valid input never builds
  one. Schemas too rich for the inline boolean guard (optional properties, enums,
  patterns, `$ref`s, unions) previously allocated an `errors` array on every call,
  including the happy path; they now create it only on the first actual error,
  mirroring the runtime interpreter's allocation-free valid path. Measured ~+45%
  throughput on a small object with an optional field and ~+6% on a nested order
  schema, with no change to the already-guarded all-required shapes.

  Also emit `enum` membership as a parenthesized `===` chain instead of a
  per-call `[...].includes(...)` array (allocation-free for primitive members),
  and fix a latent soundness gap in the boolean type-guard: array item checks now
  go through `Array.from` so a sparse array (a hole left by `delete arr[i]`) gets
  the same verdict as the error-collecting validator, which reads the hole as
  `undefined` and rejects it. `Array.prototype.every` skipped the hole and wrongly
  accepted it.

## 0.10.0

### Minor Changes

- 0db1446: Generate a boolean type-guard `isX(input): input is X` alongside every
  `validateX`. Where `validateX` returns a rich `ValidationResult` (and routes a
  failure to a separate error-collecting function), `isX` is a single flat boolean
  predicate — no error array, no cold-path call — so V8 inlines it like a
  hand-written `check`, matching the shape of TypeBox's compiled checker. It
  returns the _exact same verdict_ as `validateX` (constraints are emitted as the
  negation of the validator's error condition, so even edge values like `NaN` on a
  constrained number agree); when a schema carries something the flat form can't
  mirror ($ref, unions, `const`, x-mjst, pattern/dependent keywords), `isX` falls
  back to `validateX(input) === true`, which is always correct. The guard is
  re-exported from the generated `index`, giving consumers an allocation-free
  predicate for the common "is this valid?" check.

## 0.9.0

### Minor Changes

- f794ca6: Make generated object validators substantially faster on the happy path by
  reshaping the emitted function. `validateX` now keeps its boolean guard inlined
  as an early `return true` and delegates only the cold, error-collecting body to a
  separate function, so the hot path stays tiny enough for V8 to optimise well.
  The guard also drops the redundant `!Array.isArray(...)` term whenever a required
  property's `typeof` check already rejects arrays (kept when a `length`/index key
  could let an array through), and uses dotted property access for identifier keys.
  The exported API and `ValidationResult` contract are unchanged. On the
  `moltar/typescript-runtime-type-benchmarks` shapes this lifts steady-state
  valid-input throughput from ~59M to ~110M ops/s (loose) and ~39M to ~98M ops/s
  (strict), edging past typia.

## 0.8.0

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

- 6fb26a2: Generated object validators now run an allocation-free boolean guard on the
  happy path. For all-required objects of bare-typed properties (and likewise
  nested objects), the validator first evaluates a single `&&` chain of `typeof`
  checks — with an `Object.keys().length === N` count standing in for the
  unknown-key sweep when the object is closed with `additionalProperties: false` —
  and returns `true` immediately when it passes. Only when the guard fails does
  execution fall through to the existing error-collecting body, so invalid input
  still gets full JSON-Pointer errors and every verdict is unchanged. The guard is
  emitted only when it can prove validity cheaply; schemas with constraints it
  can't express (patterns, ranges, enums, `$ref`, arrays, optional or extra-keyed
  objects) keep their previous output. On the
  `moltar/typescript-runtime-type-benchmarks` shape this moves valid-input
  throughput past TypeBox's compiled checker both with and without
  `additionalProperties: false`.

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

## 0.7.0

### Minor Changes

- cff0369: Generated validators no longer silently skip checks that the runtime
  interpreter performs, closing two correctness gaps:

  - **Inline nested objects are validated recursively.** An object schema written
    directly under `properties` (rather than referenced via `$ref`) previously
    only produced an "is an object" shape check; its fields went completely
    unchecked. The generator now recurses to any depth, reporting errors at the
    correct nested JSON Pointer paths, and `$ref`s buried inside inline nested
    objects are collected as imports.
  - **`additionalProperties: false` is enforced.** Undeclared keys are now
    rejected with the interpreter's `must NOT have additional properties`
    message, at both the root and nested levels. The known-keys Set is hoisted to
    module scope and the sweep uses an allocation-free `for...in` loop, so the
    generated validators stay at Ajv-compiled speed. Schemas combining it with
    `patternProperties` skip the sweep for now, since the generator does not
    evaluate key patterns yet.

  Also fixes array item error paths, which duplicated the property name
  (`/tags/tags/0` instead of `/tags/0`), and updates the README benchmark tables:
  the old throughput numbers were inflated by the skipped nested checks.

  Inputs that previously passed validation against strict or nested schemas may
  now (correctly) fail.

### Patch Changes

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

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.6.0

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

### Patch Changes

- Updated dependencies [51c2032]
  - @amritk/helpers@0.8.0

## 0.5.1

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/helpers@0.7.1

## 0.5.0

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

## 0.4.2

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/helpers@0.6.2

## 0.4.1

### Patch Changes

- Updated dependencies [ccecc67]
  - @amritk/helpers@0.6.1

## 0.4.0

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

## 0.3.1

### Patch Changes

- Updated dependencies [99f1876]
  - @amritk/helpers@0.5.0

## 0.3.0

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

## 0.2.3

### Patch Changes

- Updated dependencies [83eb57a]
  - @amritk/helpers@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [cbc0e4c]
  - @amritk/helpers@0.2.2

## 0.2.1

### Patch Changes

- dbf49bf: Republish via npm trusted publishing (OIDC).
- Updated dependencies [dbf49bf]
  - @amritk/helpers@0.2.1

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.

### Patch Changes

- ad1efe5: chore: initial release
- Updated dependencies [ad1efe5]
- Updated dependencies [53fa6bf]
  - @amritk/helpers@0.2.0
