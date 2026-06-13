---
"@amritk/runtime-validators": patch
---

Allocate the regex and `$ref` caches lazily. A validator now defers building
either `Map` until the schema first hits a `pattern`/`patternProperties` or a
`$ref`/`$dynamicRef`, so the first validation of the common schema that has
neither allocates 1 `Map` instead of 3. Schemas that do use those keywords
build the same caches on first use, with no change in behavior.
