---
"@amritk/lint": minor
---

Add a built-in OpenAPI ruleset at the `@amritk/lint/rules/openapi` subpath.

The core engine stays format-agnostic, but OpenAPI is now available as a ready-made preset layered on top of it — with no new dependencies. The subpath exports the `oas` ruleset, the OpenAPI-specific functions (`oasFunctions` / `allFunctions`), format detectors (`oasFormats`), auto-fixers (`oasFixers`), the bundled structural meta-schemas (`oas2Schema` / `oas3Schema` / `oas31Schema`), and two helpers:

- `createOpenApiRuleset(definition?, basePath?)` — builds a runnable `Ruleset` with the OpenAPI functions and formats layered over the built-ins, defaulting to `extends: [oas]` (recommended rules only). Feed it to the core `lintWithResult` (with a `$ref` resolver for `resolved: true` rules).
- `resolveOpenApiRuleset(name, basePath?)` — resolves `extends` references, including the `oas` / `loupe:oas` / `spectral:oas` names so existing Spectral-style rulesets extend unchanged.

Structural schema validation for OpenAPI 3.1 and 3.2 now uses the **official, self-contained `spec.openapis.org` meta-schemas** (vendored verbatim, exported as `oas31Schema` / `oas32Schema`). Because OpenAPI 3.1/3.2 express Schema Objects as JSON Schema 2020-12 through a local `$dynamicRef`/`$dynamicAnchor` — which `@amritk/runtime-validators` resolves natively — no bundling or dialect engine is needed. This replaces the previous hand-written 3.1 envelope (which under-validated the document structure) and adds a new `oas3_2-schema` rule so OpenAPI 3.2 documents are structurally validated too. The vendored OpenAPI 3.0 schema is also refreshed to the latest official revision (`spec.openapis.org/oas/3.0/schema/2024-10-18`), keeping the two minimal draft-04 adaptations; it produces identical verdicts to the prior revision on the real-world 3.0 specs tested.
