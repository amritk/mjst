---
---

Re-measure every benchmark quoted in a README, and make the `@amritk/api` cross-framework table reproducible

All seven benchmark suites were re-run on one machine (Bun 1.3.11 / Node 22, Linux
x64) and the numbers in the root README, `generate-validators`, `generate-parsers`,
`runtime-validators`, `resolve-refs`, `yaml`, `lint`, and `api` READMEs now report
what those suites actually print. Most moved a little; a few moved enough to change
what the surrounding prose could honestly claim, and that prose moved with them —
generated validators are now ~10% ahead of typia on `assert-loose` rather than tied,
the `order` validator gained ~40%, and the runtime-validators cold-start advantage
over Ajv reads ~97–720× rather than ~110–1100×.

The `api` table was the one that could not be reproduced at all: it compared against
Hono, and no such benchmark existed in the repo — so its numbers could neither be
checked nor refreshed. `packages/api/bench/vs-frameworks.ts` now runs that
comparison (bare Hono, Hono + `@hono/zod-validator`, the runtime engine, and the
compiled engine, all `Request` → `Response` on the same three routes, with a status
parity check before timing), under Node via `bun run bench:vs` and under Bun via
`bun run bench:vs:bun`. The README reports both, because they tell materially
different stories: undici's `Request`/`Response` construction is a large fixed cost
every column pays, which compresses the Node table toward the runtime's floor.

No published code changed — READMEs, a new benchmark, and `devDependencies` only.
