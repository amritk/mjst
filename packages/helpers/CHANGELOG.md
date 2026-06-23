# @amritk/helpers

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
