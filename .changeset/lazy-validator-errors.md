---
"@amritk/generate-validators": patch
---

perf: lazily allocate the validator's error array so valid input never builds
one. Schemas too rich for the inline boolean guard (optional properties, enums,
patterns, `$ref`s, unions) previously allocated an `errors` array on every call,
including the happy path; they now create it only on the first actual error,
mirroring the runtime interpreter's allocation-free valid path. Measured ~+45%
throughput on a small object with an optional field and ~+6% on a nested order
schema, with no change to the already-guarded all-required shapes.

Also emit `enum` membership as a parenthesized `===` chain instead of a
per-call `[...].includes(...)` array (allocation-free for primitive members),
and fix a latent soundness gap in the boolean type-guard: array item checks now
go through `Array.from` so a sparse array (a hole left by `delete arr[i]`) gets
the same verdict as the error-collecting validator, which reads the hole as
`undefined` and rejects it. `Array.prototype.every` skipped the hole and wrongly
accepted it.
