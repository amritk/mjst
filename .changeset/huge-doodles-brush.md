---
---

Bench the validator and parser suites against zod 4.5 and move the dev
dependency from `^4.4.3` to `^4.5.4`.

zod is a benchmark rival and a schema *source* for `@amritk/adapters`; it is a
devDependency everywhere it is pinned, so nothing published changes and no
package needs a bump.

Both suites were re-run on one Linux x64 box (Bun 1.3.11) on 4.4.3 and then on
4.5.4, each library timed in its own process as the harnesses already do. On the
valid-input path — the only path the README tables report — zod 4.5 is flat
against 4.4 on every case in both suites, well inside run-to-run spread, so the
published tables keep their numbers.

The change is on the *invalid* path, which those tables do not report: zod's
error-collecting throughput is roughly 2.1–2.7× higher on every case
(`small` ~70k → ~187k ops/s, `order` ~40k → ~98k, `assert-loose` ~144k → ~380k,
`assert-strict` ~139k → ~293k). Confirmed over three repeats per version.
