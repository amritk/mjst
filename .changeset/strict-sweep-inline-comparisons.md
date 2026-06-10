---
'@amritk/generate-validators': patch
---

Speed up the `additionalProperties: false` unknown-key sweep in generated
validators. For objects with up to 16 declared properties, the sweep now tests
each key against an inline chain of `!==` comparisons instead of a hoisted
`Set.has` lookup — the shape Ajv and TypeBox compile to, which V8 evaluates
faster for small key counts and which avoids the per-module `Set` allocation.
Schemas with more declared keys keep the `Set` fallback. Roughly triples valid
throughput on small strict schemas in the benchmark suite.
