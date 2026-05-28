---
"@amritk/helpers": patch
---

Fix JSDoc comment emission in generated type definitions.

- Emit `/** description */` comments for properties inside `allOf` inline object schemas (previously they were silently dropped).
- Emit `description` as a top-level JSDoc comment when a `$ref` is factored out, matching the existing `$comment` behaviour (`description` takes precedence when both are present).
