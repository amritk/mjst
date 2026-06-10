---
---

Add a reproducible parse benchmark to @amritk/generate-parsers (`bun run
bench`), mirroring the validators benchmark harness (isolated process per
library, median-of-trials, DCE/LICM-resistant input pool). It replicates both
parse modes of `moltar/typescript-runtime-type-benchmarks` — parseSafe (assert
types and strip undeclared keys) and parseStrict (assert types and reject
undeclared keys) — comparing the generated mjst parser against zod and TypeBox,
the two libraries with a pure (non-mutating) parse operation. Dev tooling only;
no published output changes.
