---
"@amritk/lint": minor
"@amritk/lint-core": minor
"@amritk/lint-parsers": minor
"@amritk/lint-functions": minor
"@amritk/lint-formatters": minor
"@amritk/lint-fix": minor
"@amritk/lint-cli": minor
---

Add a format-agnostic JSON/YAML linting toolchain.

New packages:

- `@amritk/lint-parsers` — YAML/JSON parsing with exact source positions.
- `@amritk/lint-core` — the engine: documents, ruleset loading/merging, a compiled JSONPath, and the rule runner.
- `@amritk/lint-functions` — built-in rule functions (`schema` (JSON Schema, via `@amritk/runtime-validators`), `truthy`, `pattern`, `casing`, `alphabetical`, `length`, `enumeration`, `xor`, …).
- `@amritk/lint-formatters` — output formatters (stylish, json, junit, sarif, …).
- `@amritk/lint-fix` — the auto-fix plumbing (maps findings to formatting-preserving edits, as a lint plugin).
- `@amritk/lint` — the entry point: `createRuleset`, `lintDocument`, and `fixDocument`, wiring the built-in functions plus custom-rule/function loading.
- `@amritk/lint-cli` — the `lint` binary: glob inputs, `.lint.*` ruleset discovery, format outputs, and exit codes.

This is JSON/YAML style-guide linting with JSON Schema and custom rules only — no OpenAPI-specific rulesets, functions, or `$ref` resolution.
