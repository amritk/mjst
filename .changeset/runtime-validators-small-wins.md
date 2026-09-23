---
"@amritk/runtime-validators": patch
---

Two smaller speedups. `validate(schema)(value)` called inline with no options reuses a precomputed cache key instead of building one per call, which makes the lookup about 7× cheaper. An array-form `type` whose names are all ones the spec defines (the common `['string', 'null']`) compiles to predicates up front, which makes those checks about a third faster. Behaviour is unchanged; an unknown type name still throws only when a value reaches it.
