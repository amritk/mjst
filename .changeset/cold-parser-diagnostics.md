---
'@amritk/generate-parsers': minor
---

Hoist per-property parser diagnostics into a cold function

The per-property assertions a parser emits to pinpoint which field failed never
run on a clean input, but leaving them inline still costs: the dead bytecode
pushes the parser past the engine's inlining budget. This is the same effect
already noted on the unknown-key rejection loop.

Emitting them as a `_assert<Type>` function called from the guard's failure
branch leaves the error messages byte-identical and measured ~2.1x on safe
parsing and ~1.25x on strict parsing of the
`typescript-runtime-type-benchmarks` payload.
