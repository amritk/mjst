---
"@amritk/lint": minor
---

Add a built-in OpenAPI ruleset at the `@amritk/lint/rules/openapi` subpath.

The core engine stays format-agnostic, but OpenAPI is now available as a ready-made preset layered on top of it — with no new dependencies. The subpath exports the `oas` ruleset, the OpenAPI-specific functions (`oasFunctions` / `allFunctions`), format detectors (`oasFormats`), auto-fixers (`oasFixers`), the bundled structural meta-schemas (`oas2Schema` / `oas3Schema` / `oas31Schema`), and two helpers:

- `createOpenApiRuleset(definition?, basePath?)` — builds a runnable `Ruleset` with the OpenAPI functions and formats layered over the built-ins, defaulting to `extends: [oas]` (recommended rules only). Feed it to the core `lintWithResult` (with a `$ref` resolver for `resolved: true` rules).
- `resolveOpenApiRuleset(name, basePath?)` — resolves `extends` references, including the `oas` / `loupe:oas` / `spectral:oas` names so existing Spectral-style rulesets extend unchanged.
