---
"@amritk/runtime-validators": patch
---

perf: cut per-walk work in the interpreter without adding any up-front schema
analysis, so the cold one-shot path (this package's design target) gets faster
rather than paying an amortized compile cost.

- Dispatch the type-specific keyword blocks on the *value's* type. A value is
  only ever one of object / array / string / number and each block is inert for
  the others, so the walk now runs the at-most-one block that can do work
  instead of calling all four and letting three early-return.
- Avoid wrapping a single `type` keyword in a throwaway one-element array on
  every typed node, and build the `enum` mismatch label only on failure rather
  than allocating it (a `map`/`join`) on every successful check.

Measured on `bun run bench`: cold `validate` ~30–45% faster on the small/wide
cases and steady-state throughput up ~30–90%, with no regression to the cold
path. Behaviour is unchanged — all unit tests and the ~144k-value differential
fuzz against Ajv still pass.
