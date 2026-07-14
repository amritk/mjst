---
"@amritk/generate-validators": patch
---

Fix `uniqueItems` in generated validators to match runtime `deepEqual`
semantics. The generated dedupe check previously projected every item through
`JSON.stringify`, which is key-order sensitive — so an array of two objects with
the same entries in a different key order (`{ a: 1, b: 2 }` vs `{ b: 2, a: 1 }`)
was wrongly accepted, while `@amritk/runtime-validators` (and Ajv) treated them
as duplicates via order-independent structural equality.

The generator now emits a structural `allUnique` helper from
`validation-result.ts` and calls it whenever an array's items may be objects or
arrays (or are unconstrained), keeping the cheap `JSON.stringify` projection only
for provably scalar-only items. Both the error-collecting validator and the
boolean type-guard take the same split, so their verdicts stay in lockstep.
