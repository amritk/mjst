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
- Memoize the allocation-heavy parts of an object schema node (its property
  keys, the `required` membership set, and the compiled `patternProperties`
  entries) keyed on the node, so they are built once instead of on every
  validation. This is done only for object nodes (few in number) and lazily, so
  the cold one-shot path pays at most a handful of small allocations — and an
  object node revisited within a single walk (an array of objects, a recursive
  `$ref`) rebuilds none of it, which speeds up the cold path too.

Measured on `bun run bench`: steady-state throughput is ~2–3.4× the previous
baseline (the reuse-heavy path that matters for long-lived consumers such as a
linter), and the cold one-shot path is also faster across the board (e.g. the
deep `$ref` schema roughly halved). Behaviour is unchanged — all unit tests and
the ~144k-value differential fuzz against Ajv still pass.
