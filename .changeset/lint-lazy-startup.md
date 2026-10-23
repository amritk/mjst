---
"@amritk/mjst": patch
---

`mjst lint` loads less at startup. A run on a single file no longer imports `fast-glob`, which is now loaded only for a glob, a directory or several paths. `@amritk/resolve-refs` is loaded only when `$ref` resolution is on, so a `--no-resolve` run skips it; a default run still loads it. On a tiny OpenAPI file this takes about 30–55 ms off a run with a ruleset of plain style checks on Node, and about 25–45 ms off runs on Bun, with or without `-r oas`. The Node `-r oas` gain is within run-to-run noise.
