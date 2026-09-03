---
"@amritk/runtime-validators": patch
"@amritk/generate-parsers": patch
"@amritk/generate-validators": patch
---

Performance: faster steady-state validation and parsing.

- `@amritk/runtime-validators`: a prepared validator now keeps one run context for its lifetime instead of allocating a context, a budget holder and a ref stack per call, and branch probes (`anyOf`, `oneOf`, `not`, `if`, `contains`, `propertyNames`) run in place rather than in a fresh context each. A scoped `$ref` (a document with `$id`) caches the target it resolved for the base last seen, and `uniqueItems` compares up to eight primitives pairwise instead of building a `Set`. Measured on the bench suite: the guard path runs 1.5–2.8× faster and the error-collecting path 1.1–1.3× faster.
- `@amritk/generate-parsers`: a parser's result object is no longer built with a conditional spread per optional property (`...(_x !== undefined && { x: _x })`); the optional properties are assigned after the literal, in declared order, so the output and its key order are unchanged while the parse of an object with optional properties runs roughly 1.8× faster on Node and 2.5× on Bun.
- `@amritk/generate-validators`: the boolean guard (`isX`) iterates array items through a new `everyItem` helper exported from the generated `validation-result.ts` instead of copying the array with `Array.from` on every call.
