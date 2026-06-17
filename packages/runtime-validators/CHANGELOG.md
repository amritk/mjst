# @amritk/runtime-validators

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
