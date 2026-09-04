---
"@amritk/runtime-validators": patch
"@amritk/generate-parsers": patch
"@amritk/generate-validators": patch
---

Performance: faster steady-state validation and parsing.

- `@amritk/runtime-validators`: a prepared validator now keeps one run context for its lifetime instead of allocating a context, a budget holder and a ref stack per call, and branch probes (`anyOf`, `oneOf`, `not`, `if`, `contains`, `propertyNames`) run in place rather than in a fresh context each. A scoped `$ref` (a document with `$id`) caches the target it resolved for the base last seen, and `uniqueItems` compares up to eight primitives pairwise instead of building a `Set`. Measured on the bench suite against `main` (Bun, isolated processes, median of 21 trials): the guard path runs 1.2–2.3× faster on valid input and 1.5–3.4× faster on invalid input, and the error-collecting path 1.1–1.6× faster.
- `@amritk/generate-parsers`: a parser's result object is no longer built with a conditional spread per optional property (`...(_x !== undefined && { x: _x })`); the optional properties are assigned after the literal, in declared order, so the output and its key order are unchanged while a parse that builds an object with optional properties runs 1.5–2.8× faster on the bench suite (`Order · strict` 6.6M → 10.3M ops/s, `User · strict` 11.7M → 32.5M ops/s; V8 gains at least as much, since it treats the conditional spread as a generic copy).
- `@amritk/generate-validators`: the boolean guard (`isX`) iterates array items through a new `everyItem` helper exported from the generated `validation-result.ts` instead of copying the array with `Array.from` on every call.
