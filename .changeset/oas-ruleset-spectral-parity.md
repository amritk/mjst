---
"@amritk/lint": minor
---

fix(openapi): close correctness and coverage gaps in the `oas` ruleset for closer `spectral:oas` parity.

- `oasPathParam` now evaluates path parameters per operation (path-item + operation params), adding the missing "unused definition", "required: true", and "duplicate definition" checks.
- `oasMediaExample` is version-split so OpenAPI 2.0 response examples (a MIME-type → value map) are validated against the sibling `schema`.
- Example/schema validation now asserts standard JSON Schema formats (matching Spectral's `ajv-formats`), validates `default`, skips `properties`/`patternProperties` maps, and never crashes on an unresolvable `$ref` in an example schema.
- `oas3-api-servers` / `oas2-api-schemes` now report a missing (not just empty) `servers`/`schemes`.
- `oasOpSuccessResponse` no longer counts `default` as success and accepts `2XX`/`3XX` wildcards; `oasOpParams` adds the OAS2 multiple-`in:body` check; `oasUnusedComponent` matches refs by prefix and covers `components.pathItems`; `oasServerVariables` checks default/enum; `oasOpIdUnique` is gated to real operation methods.
- 3.2 `query` operations, webhook path-item servers, `title` markdown scanning, and anchored 3.x version detection are all handled; `nullable` detection uses a schema-aware function.
- Fixers: `path-keys-no-trailing-slash` gains a collision guard, `duplicated-entry-in-enum` uses an order-independent dedup key, `openapi-tags-alphabetical` matches the `alphabetical` comparator, and a new `oas3_1-schema-example-deprecated` fixer migrates `example` to `examples`.
