# @amritk/adapters

## 0.3.0

### Minor Changes

- 29b7a18: Bring the Valibot adapter to parity with Zod for lossy conversions, and add an
  opt-in strict mode to both.

  - The Valibot adapter previously ran `@valibot/to-json-schema` in
    `errorMode: 'warn'` and let that library log widening in its own words, one
    line per construct — from mjst's side, Valibot widening was effectively
    invisible. It now runs the converter in `errorMode: 'ignore'`, collects the
    constructs it could not represent (unrepresentable schema types that degrade
    to an open schema, plus refinements like flagged regexes that JSON Schema
    cannot express) via the converter's override hooks, and emits a single
    batched, `[mjst]`-branded `console.warn` — the same style the Zod adapter
    already uses. `date` and `bigint` remain rescued into the shared `x-mjst`
    hint and are never reported as lossy.
  - Both `zodToJsonSchema` and `valibotToJsonSchema` now accept an
    `{ strict?: boolean }` options argument (surfaced on the shared `Adapter`
    type as `AdapterOptions`). In strict mode a construct that cannot be fully
    represented throws instead of silently widening the generated type.

- 5d89429: Add a Zod 3 fallback to the Zod adapter. When the installed `zod` lacks the
  native `toJSONSchema` (Zod 3), the adapter now routes conversion through the
  optional `zod-to-json-schema` peer dependency, applying the same `x-mjst`
  date/bigint mapping and lossy-type warnings as the Zod 4 path. If neither Zod 4's
  `toJSONSchema` nor `zod-to-json-schema` is available, a clear error explains what
  to install.

### Patch Changes

- 815f9ab: Declare `@sinclair/typebox` as an optional peer dependency (`>=0.34`).

  The TypeBox pass-through adapter (`typebox-to-json-schema`) relied on TypeBox's
  plain-object schema shape but had no `peerDependencies` entry, so there was no
  version signal or guard for it. Adding the optional peer (mirroring the
  `peerDependenciesMeta` pattern already used for zod, valibot,
  `@valibot/to-json-schema`, and effect) records the supported range and lets
  package managers surface an incompatible TypeBox version instead of failing
  silently on a future shape change.

- 88b549a: fix: the Effect adapter now rescues nested `Schema.BigIntFromSelf` /
  `Schema.DateFromSelf` instead of throwing. Previously only a top-level bigint or
  runtime `Date` was mapped to an `x-mjst` hint, so a `BigIntFromSelf` /
  `DateFromSelf` buried inside a struct, array, or union made `JSONSchema.make`
  fail outright — unlike the Zod, Valibot, and TypeBox adapters, which handle
  nested date/bigint fine. The rescue is now recursive: representable subtrees are
  still converted verbatim by Effect, and only the branches leading to an
  unrepresentable leaf are walked to attach `x-mjst` `primitive: 'bigint'` /
  `instanceOf: 'Date'` hints at the corresponding nested paths. The documented
  encoded-representation semantics for `Schema.Date` (a string) are unchanged.
- Updated dependencies [9bf3330]
- Updated dependencies [e612130]
  - @amritk/helpers@0.13.0

## 0.2.16

### Patch Changes

- Updated dependencies [1bb7a25]
  - @amritk/helpers@0.12.0

## 0.2.15

### Patch Changes

- Updated dependencies [91dab2b]
- Updated dependencies [9253843]
  - @amritk/helpers@0.11.0

## 0.2.14

### Patch Changes

- Updated dependencies [02f6b05]
  - @amritk/helpers@0.10.3

## 0.2.13

### Patch Changes

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

## 0.2.12

### Patch Changes

- Updated dependencies [7d43e6f]
  - @amritk/helpers@0.10.1

## 0.2.11

### Patch Changes

- e57d6ca: Two more adapter fidelity fixes:

  - **Effect**: a top-level `Schema.BigIntFromSelf` / `Schema.DateFromSelf` now
    converts to the shared `x-mjst` hint (`primitive: 'bigint'` / `instanceOf:
'Date'`) instead of throwing, matching the Zod, Valibot, and TypeBox adapters.
    A nested unrepresentable bigint/Date now throws an actionable error pointing at
    the string-encoded `Schema.BigInt` / `Schema.Date` or a `jsonSchema` annotation.
  - **Zod**: an object intersection (`z.intersection` / `.and`) emitted an `allOf`
    of two `additionalProperties: false` objects, which is unsatisfiable (each
    branch rejects the other's keys). When every `allOf` branch is a closed object
    the adapter now merges them into one object — properties unioned, `required`
    unioned, `additionalProperties: false` kept. Non-object intersections (e.g. two
    refined strings) are left as an `allOf`.

- b6e103d: Enforce tuple length in the Zod adapter. Zod 4's `toJSONSchema` emits a fixed
  tuple as a bare `prefixItems` array with no length bound, so the converted schema
  accepted arrays that were too short (trailing positions went unchecked) or too
  long (nothing forbade extra items) — values the Zod schema itself rejects. The
  adapter now restores the constraint: `minItems` requires the fixed elements, and
  a tuple with no `.rest(...)` gets `items: false` to forbid extras. Tuples with a
  rest element keep their open tail. Applied to every `prefixItems` node, so nested
  tuples are fixed too.

## 0.2.10

### Patch Changes

- Updated dependencies [cdfe681]
  - @amritk/helpers@0.10.0

## 0.2.9

### Patch Changes

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.2.8

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

## 0.2.7

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/helpers@0.7.1

## 0.2.6

### Patch Changes

- Updated dependencies [6fdb8bf]
  - @amritk/helpers@0.7.0

## 0.2.5

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/helpers@0.6.2

## 0.2.4

### Patch Changes

- Updated dependencies [ccecc67]
  - @amritk/helpers@0.6.1

## 0.2.3

### Patch Changes

- Updated dependencies [9fea346]
  - @amritk/helpers@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [99f1876]
  - @amritk/helpers@0.5.0

## 0.2.1

### Patch Changes

- d14d39f: Publish `@amritk/adapters` for converting external schemas (TypeBox, Zod, Valibot, Effect) into JSON Schema for mjst.

## 0.2.0

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
