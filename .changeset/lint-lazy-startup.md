---
"@amritk/lint": patch
"@amritk/mjst": patch
---

`mjst lint` starts faster by loading only what a run uses. `@amritk/lint` now imports `@amritk/runtime-validators` when a run's rules may call the `schema` function, instead of whenever the package is imported; the public API is unchanged and `schema` stays synchronous. A direct `schema()` call made before any lint run loads the validator with `require()`, which needs Bun or Node 20.19+ / 22.12+. The CLI imports `fast-glob` only when a document argument is a glob, a directory or more than one path, and `@amritk/resolve-refs` only when `$ref` resolution is on. On a tiny OpenAPI file this takes about 60 ms off a run with a ruleset of plain style checks and about 25 ms off `-r oas`, on Node and Bun.
