---
'@amritk/mjst': minor
---

Add `--help` / `-h` and print usage when the CLI is invoked with no arguments.

Running `mjst` with no arguments (or `mjst --help` / `-h` / `help`) previously
errored with "--out-dir or --out-file is required". It now prints a usage
summary listing every flag — schema, schema-dir, out-dir, out-file, input,
export, types-only, build, strict, log-warnings, strip-unknown, readonly,
helpers, type-suffix, banner, import-ext, root-type, config, and version.
