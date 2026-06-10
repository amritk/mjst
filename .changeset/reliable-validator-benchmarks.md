---
---

Rework the `@amritk/generate-validators` benchmark into a reliable replication of
the steady-state half of `moltar/typescript-runtime-type-benchmarks`. Each
library is now timed in its own isolated process (so JIT state and GC can't bleed
between libraries), and every measurement reports the median over many timed
trials plus a stability spread — replacing the single noisy sample that made
run-to-run numbers swing wildly. Benchmark-only; no published code changes.
