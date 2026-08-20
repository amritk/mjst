---
'@amritk/generate-validators': minor
---

Judge a combinator branch against a value that is there, and count `contains` by
index.

Both are verdict changes for values JSON cannot hold — an array hole, or an
explicit `undefined` — and both move the generated validator onto the answer
`@amritk/runtime-validators` and Ajv already give.

A combinator's branches were evaluated in optional mode even where the caller had
already established the value is present, so every leaf check inside them read
`x !== undefined && …` and a hole satisfied all of them: `prefixItems: [{ allOf:
[{ type: 'string' }] }]` accepted `[<hole>]` that `prefixItems: [{ type: 'string' }]`
rejected. `contains` counted matches with `filter`, which skips holes outright, so
a sparse array came up an element short — and against `contains: { not: { type:
'string' } }` the hole is the matching item.

The `contains` loop stops at `minContains` when there is no `maxContains` to
count for, and emits nothing at all for a `minContains: 0` that no array can fail.
A schema-form `additionalProperties` now tests declared keys through the shared
`unknownKeyCheck` instead of rebuilding an array literal for every key of every
object it validates.
