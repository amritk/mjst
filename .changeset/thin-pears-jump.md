---
'@amritk/generate-validators': patch
---

Add a differential fuzz over the whole generated set: random schemas carrying a
`$ref` into `$defs`, combinators, tuples, `contains` and hostile property names
are built, linked and run, and every verdict is held against both the runtime
interpreter and Ajv, with `isX` held against `validateX`. The existing fuzz
covers one emitted function against Ajv; this covers what only appears once the
output is several files that have to import and call each other.
