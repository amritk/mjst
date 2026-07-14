---
"@amritk/generate-examples": patch
---

Collect `$ref` imports from the full schema surface the generators traverse.

`collectExampleImports` only harvested `$ref`s from top-level
`properties`/`items`/`additionalProperties` and top-level combinator branches,
but `arbitraryExpr` (and the type generator) recurse deeper — into tuple
`prefixItems`, array-form `items`, `patternProperties`, and combinators nested
under a property. A `$ref` hidden in any of those emitted a bare `XxxArbitrary`
identifier (or a bare `Xxx` type) with no matching import, producing an example
file that failed to compile. Import collection now recurses over that same
surface via a single ref-walking helper, so every referenced ref is imported.
