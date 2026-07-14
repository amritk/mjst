---
"@amritk/generate-examples": minor
"@amritk/helpers": minor
---

feat: honour previously-ignored schema constraints so generated examples and
arbitraries validate against their own schema. Both codepaths now implement
`patternProperties`, `propertyNames`, `dependentRequired`, `dependentSchemas`,
`minProperties`, `maxProperties`, and `contains` (the arbitrary path previously
skipped `minProperties`/`contains`), and filter `enum` members by their sibling
length/range/pattern constraints. `if`/`then`/`else`, `not`, and `oneOf`
exclusivity — which no structural generator captures — are reconciled by a
post-generation validating filter built with `@amritk/runtime-validators`:
`deriveExample` re-derives and rejects candidates until one validates, and the
generated arbitrary appends a `.filter(...)` backed by a runtime validator (that
file then imports `@amritk/runtime-validators`; files that need no filter don't).
`@amritk/helpers` gains `hasPatternProperties`, `hasDependentSchemas`,
`hasContains`, `hasNot`, and `hasIf` schema guards.
