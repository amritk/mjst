---
"@amritk/adapters": patch
---

Fix the Effect adapter emitting draft-07 tuples that downstream generators under-validate. `JSONSchema.make` (and the adapter's structural rescue path) express a fixed tuple as `items: [...]` + `additionalItems`, but the mjst pipeline recognizes a tuple only by 2020-12 `prefixItems` — so `Schema.Tuple(Schema.String, Schema.Number)` produced an array whose element types and length were never checked. The adapter now normalizes tuples to `prefixItems` and restores the length bound, matching the Zod and Valibot adapters. The tuple-normalization helpers are now shared between the Zod and Effect adapters instead of living privately in the Zod one.
