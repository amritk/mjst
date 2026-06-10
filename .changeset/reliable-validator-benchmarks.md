---
---

Rework the `@amritk/generate-validators` benchmark into a reliable replication of
the steady-state half of `moltar/typescript-runtime-type-benchmarks`. Each
library is now timed in its own isolated process (so JIT state and GC can't bleed
between libraries); every measurement reports the median over many timed trials
plus a coefficient-of-variation stability flag; the validator runs over a pool of
distinct object identities with its verdict folded into an escaping sink, so the
optimiser can't hoist or dead-code-eliminate the work (which had been inflating
library throughput to billions of impossible ops/sec). Adds `typia` — the
build-time transformer that is the closest peer to mjst's generated validators —
to the comparison, run through the `unplugin-typia` Bun plugin. Benchmark-only;
no published code changes.
