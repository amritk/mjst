---
"@amritk/generate-markdown": minor
---

Resolve `$ref`/`$defs` and infer types from composition keywords. `$ref`
pointers are now inlined from the document's `$defs` (any `#/…` JSON pointer)
before rendering, with recursive definitions detected and collapsed so
generation always terminates and sibling keywords on a `$ref` (e.g.
`description`) overriding the referenced definition. Properties that describe
their type through `enum`, `const`, or `anyOf`/`oneOf`/`allOf` instead of a
plain `type` now get an inferred **Type** label. This lets schemas assembled
from reusable definitions render directly, without pre-bundling.
