---
"@amritk/mjst": minor
---

Add a `--validators` flag (config key `"validators": true`) to the `mjst` CLI.
When set, the CLI also emits validation functions alongside the generated
parsers: for every generated type `X` you get a `validateX` (returning a rich
`ValidationResult` with JSON-Pointer error paths) and an `isX` boolean type
guard, produced by `@amritk/generate-validators`. The validator files carry the
same schema-derived filenames as the parsers, so they land in a `validators/`
subdirectory of the output to avoid colliding. This works with both `--schema`
and `--schema-dir` (the `validators/` tree mirrors the parser layout) and with
`--build`; it cannot be combined with `--types-only` or `--out-file`, which emit
no runtime code. The README overview previously claimed the CLI produced
validators — it now does.
