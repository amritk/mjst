---
"@amritk/mjst": patch
---

`mjst lint` starts faster by loading only what a run uses. It imports `fast-glob` only when a document argument is a glob, a directory or more than one path, and `@amritk/resolve-refs` only when `$ref` resolution is on. On a tiny OpenAPI file this takes 7–56 ms off a run on Node and Bun, both with `-r oas` and with a ruleset of plain style checks.
