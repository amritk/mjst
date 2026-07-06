# @amritk/adapters

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
