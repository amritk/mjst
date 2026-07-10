# @amritk/lint

## 0.2.0

### Minor Changes

- 273bbce: Add a built-in OpenAPI ruleset at the `@amritk/lint/rules/openapi` subpath.

  The core engine stays format-agnostic, but OpenAPI is now available as a ready-made preset layered on top of it — with no new dependencies. The subpath exports the `oas` ruleset, the OpenAPI-specific functions (`oasFunctions` / `allFunctions`), format detectors (`oasFormats`), auto-fixers (`oasFixers`), the bundled structural meta-schemas (`oas2Schema` / `oas3Schema` / `oas31Schema`), and two helpers:

  - `createOpenApiRuleset(definition?, basePath?)` — builds a runnable `Ruleset` with the OpenAPI functions and formats layered over the built-ins, defaulting to `extends: [oas]` (recommended rules only). Feed it to the core `lintWithResult` (with a `$ref` resolver for `resolved: true` rules).
  - `resolveOpenApiRuleset(name, basePath?)` — resolves `extends` references, including the `oas` / `loupe:oas` / `spectral:oas` names so existing Spectral-style rulesets extend unchanged.

  Structural schema validation uses the **official `spec.openapis.org` meta-schemas, vendored as raw `.json` files** (`src/rules/openapi/schemas/`, exported as `oas2Schema` / `oas3Schema` / `oas31Schema` / `oas32Schema`). The 3.0, 3.1, and 3.2 documents are byte-for-byte verbatim from spec.openapis.org; only 2.0 differs (its external draft-04 metaschema `$ref`s are inlined, since the eval-free interpreter never fetches remote documents). OpenAPI 3.1/3.2 express Schema Objects as JSON Schema 2020-12 through a local `$dynamicRef`/`$dynamicAnchor` — which `@amritk/runtime-validators` resolves natively — so no bundling or dialect engine is needed. This replaces the previous hand-written 3.1 envelope (which under-validated the document structure) and adds a new `oas3_2-schema` rule so OpenAPI 3.2 documents are structurally validated too.

  The schemas load **lazily, per version**: building the ruleset embeds no schema (the `*-schema` rules carry only a version tag and validate through the `oasSchema` function), and each `*-schema` rule is format-gated to a single OpenAPI version, so linting a document only ever reads its own version's schema file — the other ~110 KB of schemas are never loaded. Use `loadOasSchema(version)` to access a schema object directly.

## 0.1.0

### Minor Changes

- 195873d: Add `@amritk/lint`: a format-agnostic JSON/YAML style-guide linter with JSON
  Schema and custom rules, in a single package.

  - `@amritk/lint` — parsing (exact source positions), the engine (documents,
    ruleset loading/merging, a compiled JSONPath, the rule runner), the built-in
    rule functions (`schema` (JSON Schema, via `@amritk/runtime-validators`),
    `truthy`, `pattern`, `casing`, `alphabetical`, `length`, `enumeration`, `xor`,
    …), and the auto-fix plumbing. `lintDocument` returns structured findings;
    rendering them is left to the caller.
  - `@amritk/mjst` — gains a `lint` subcommand: `mjst lint <files> -r <ruleset>`,
    with `.lint.*` ruleset discovery, a compact `file:line:col` report, and
    severity-based exit codes.

  JSON/YAML linting with JSON Schema and custom rules only — no OpenAPI-specific
  rulesets, functions, or `$ref` resolution.
