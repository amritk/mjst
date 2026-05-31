# @amritk/runtime-validators

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
