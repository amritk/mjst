---
"@amritk/generate-validators": minor
---

Make generated object validators substantially faster on the happy path by
reshaping the emitted function. `validateX` now keeps its boolean guard inlined
as an early `return true` and delegates only the cold, error-collecting body to a
separate function, so the hot path stays tiny enough for V8 to optimise well.
The guard also drops the redundant `!Array.isArray(...)` term whenever a required
property's `typeof` check already rejects arrays (kept when a `length`/index key
could let an array through), and uses dotted property access for identifier keys.
The exported API and `ValidationResult` contract are unchanged. On the
`moltar/typescript-runtime-type-benchmarks` shapes this lifts steady-state
valid-input throughput from ~59M to ~110M ops/s (loose) and ~39M to ~98M ops/s
(strict), edging past typia.
