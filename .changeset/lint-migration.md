---
"@amritk/lint": minor
"@amritk/mjst": minor
---

Add `@amritk/lint`: a format-agnostic JSON/YAML style-guide linter with JSON
Schema and custom rules, in a single package.

- `@amritk/lint` — parsing (exact source positions), the engine (documents,
  ruleset loading/merging, a compiled JSONPath, the rule runner), the built-in
  rule functions (`schema` (JSON Schema, via `@amritk/runtime-validators`),
  `truthy`, `pattern`, `casing`, `alphabetical`, `length`, `enumeration`, `xor`,
  …), and the auto-fix plumbing. Output formatters (stylish, json, junit, sarif,
  …) are exposed via the `@amritk/lint/formatters` subpath.
- `@amritk/mjst` — gains a `lint` subcommand: `mjst lint <files> -r <ruleset>`,
  with `.lint.*` ruleset discovery, format outputs, and severity-based exit codes.

JSON/YAML linting with JSON Schema and custom rules only — no OpenAPI-specific
rulesets, functions, or `$ref` resolution.
