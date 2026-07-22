---
"@amritk/lint": minor
---

Expose the core type surface on a dedicated `@amritk/lint/types` subpath export
and stop re-exporting those types from the main entry. Runtime values and the
engine/plugin/ruleset types still come from `@amritk/lint`; the data-model types
(`IDiagnostic`, `RulesetDefinition`, `JsonPath`, `ISource*`, `DiagnosticSeverity`,
…) now import from `@amritk/lint/types`. This replaces the barrel `export *`
re-exports with named exports sourced from a single types module.
