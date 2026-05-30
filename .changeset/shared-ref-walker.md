---
"@amritk/helpers": minor
"@amritk/generate-parsers": minor
"@amritk/generate-validators": minor
"@amritk/generate-examples": minor
---

Consolidate the `$ref`-graph traversal that the parser, validator, and example
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
