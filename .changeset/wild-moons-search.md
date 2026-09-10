---
'@amritk/lint': patch
---

Benchmark the linter against vacuum, the Go OpenAPI linter.

`bench/vacuum.ts` compares the `mjst lint` command against `vacuum lint` over
the same real-world specs the Spectral bench uses. vacuum is a compiled binary,
so the comparison is CLI to CLI: both sides are timed as whole processes, with a
near-empty document measured first so each tool's fixed startup cost can be
subtracted and the linting engines compared on their own. Run it with
`bun run bench:vacuum` (or `bench:vacuum:node`); vacuum is not a dependency, and
the bench skips cleanly when it is not installed. Paths passed on the command
line are linted as extra documents, so a spec too large to vendor into
`fixtures/` can still be measured. The README carries the resulting numbers,
including a run over Cloudflare's 24 MB `openapi.json`.
