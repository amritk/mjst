# @amritk/runtime-validators

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
