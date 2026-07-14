---
"@amritk/mjst": patch
---

Document the `--banner` flag in the bundled `config.schema.json` so config-file
users can discover and validate it, and regenerate the CLI README config table
to include it. Also refresh the stale `config` property description, which
enumerated the supported keys but omitted `input`, `export`, `stripUnknown`,
`caseInsensitive`, and `banner`.
