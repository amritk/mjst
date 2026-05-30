---
"@amritk/runtime-validators": minor
---

Support `$dynamicRef` / `$dynamicAnchor` (JSON Schema 2020-12). A `$dynamicRef`
late-binds to the document's matching `$dynamicAnchor` — the pattern OpenAPI 3.1
uses so a media-type `schema` can reference the root dialect. Resolution is
document-global (one anchor per name, as in a bundled document) and is memoized
per validator like static `$ref`s; a `$dynamicRef` written as a plain JSON
Pointer falls back to static `$ref` semantics.
