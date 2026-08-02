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
checked nor refreshed. `packages/api/bench/` now runs that comparison (bare Hono,
Hono + `@hono/zod-validator`, the runtime engine, and the compiled engine, all
`Request` → `Response` on the same three routes, with a status parity check before
timing) on all three runtimes this package targets: **workerd** via Miniflare
(`bun run bench:workerd`), Node (`bun run bench:vs`), and Bun
(`bun run bench:vs:bun`). The stacks live in one shared module so a column cannot
drift between runtimes.

The workerd run measures inside a real isolate — the loop runs in the Worker itself,
one fresh isolate per cell, because timing from outside would measure Miniflare's
loopback hop and a reused isolate moves the numbers 30–40%. It also changes what the
README can claim: under workerd the compiled engine's *peak* trials match bare Hono
(~153k vs ~154k ops/s on the static GET), but its median is 15–35% lower because
workerd pauses the `@amritk/api` columns far more often than it pauses Hono. That
pattern is consistent with allocating more per request than Hono does, is not yet
diagnosed, and is now stated in the README as open work rather than smoothed over.

No published code changed — READMEs, benchmarks, and `devDependencies` only.
