---
'@amritk/helpers': minor
'@amritk/generate-parsers': patch
'@amritk/generate-validators': patch
---

Speed up the `additionalProperties: false` unknown-key sweep in generated
parsers and validators. For objects with up to 16 declared properties, the
sweep now tests each key against an inline chain of `!==` comparisons instead of
a hoisted `Set.has` lookup — the shape Ajv and TypeBox compile to, which V8
evaluates faster for small key counts and which avoids the per-module `Set`
allocation. Objects with more declared keys keep the `Set` fallback.

The shared logic lives in a new `@amritk/helpers/unknown-key-check` export so the
parser's strict-mode and warning sweeps and the validator's strict sweep stay in
step. Roughly triples valid throughput on small strict schemas in the benchmark
suite.
