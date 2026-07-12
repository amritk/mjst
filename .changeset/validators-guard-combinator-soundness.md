---
"@amritk/generate-validators": patch
---

fix: the generated fast-path guard and boolean type-guard (`isX`) no longer
short-circuit to `true` for object schemas that carry an object-level combinator
(`allOf`/`anyOf`/`oneOf`/`not`/`if`). Previously the flat guards ignored these
keywords, so both `validateX` (via its inlined early-return) and `isX` would
accept documents the combinators reject. Such schemas now fall through to the
full error-collecting validator, which enforces them.
