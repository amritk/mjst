---
"@amritk/lint": patch
"@amritk/mjst": patch
---

Load less at lint startup. `@amritk/lint` now loads `@amritk/runtime-validators` only when a rule validates a schema, and `@amritk/yaml` only when it parses YAML, on Bun and on Node with `require(esm)` (20.19+, 22.12+). Older Node keeps loading both with the package, because `schema()` and `parseWithPointers` are synchronous and have nowhere else to load them. `mjst lint` with resolving on also no longer loads the YAML parser for a document without cross-file `$ref`s. A small JSON run with a core-functions ruleset starts about 15 ms sooner on Node and 5–8 ms sooner on Bun.

The rule runner no longer awaits each `then` when its function returns synchronously. It also reuses one target per match for every `then` without a `field`. Findings and their order are unchanged. A run of synchronous functions now finishes without yielding to the microtask queue between matches.
