---
"@amritk/generate-validators": minor
---

Enforce `minItems`, `maxItems`, and `uniqueItems` on array properties (and nested
/ `patternProperties` / `additionalProperties` array values), which were
previously parsed but ignored. `uniqueItems` dedupes by a JSON projection — exact
for primitive items (matching the boolean type-guard) and a pragmatic
deep-but-key-ordered comparison for object items. The differential fuzz test now
exercises these against Ajv, and the generated `isX` type guard enforces the same
length/uniqueness conditions so it stays in agreement with the validator.

Still unimplemented (the validator silently ignores these): `contains` /
`minContains` / `maxContains`, tuple `prefixItems`, the combinators (`allOf`,
`anyOf`, `oneOf`, `not`, `if`/`then`/`else`), and constraint validation for
top-level non-object schemas (e.g. a root `{ type: 'array', minItems }` — only
object array *properties* are covered).
