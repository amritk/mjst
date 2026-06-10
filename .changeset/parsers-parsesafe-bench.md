---
---

Add a reproducible parseSafe benchmark to @amritk/generate-parsers (`bun run
bench`), mirroring the validators benchmark harness (isolated process per
library, median-of-trials, DCE/LICM-resistant input pool). It replicates the
`moltar/typescript-runtime-type-benchmarks` parseSafe case — assert types and
strip undeclared keys — comparing the generated mjst parser against zod
`.parse` and TypeBox `Value.Parse`, the two libraries with a pure (non-mutating)
parse-and-strip operation. Dev tooling only; no published output changes.
