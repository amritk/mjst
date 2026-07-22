# AGENTS.md — @amritk/lint

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package instead? See
[`AI.md`](./AI.md).

A format-agnostic JSON/YAML style-guide linter: JSON Schema + custom rules,
emitting exact `line:column` findings.

## Commands

```bash
bun run --filter='@amritk/lint' test
bun run --filter='@amritk/lint' types:check
```

## Invariants — do not break these

- **The core engine is dependency-light by design:** it ships **no** `$ref`
  resolver, **no** built-in ruleset, and **no** fixers. Those are caller-injected
  (`resolve` hook, `fixers` registry, `extends` targets). Keep that separation —
  don't bake a resolver into core.
- **Two severity vocabularies:** rulesets author strings
  (`error`/`warn`/`info`/`hint`/`off`); findings carry numeric
  `DiagnosticSeverity` (0–3). Don't unify them.
- **Ranges are zero-based** `{ line, character }`. Preserve that; the `+1` for
  display is the caller's job.
- **OpenAPI support lives in the `./rules/openapi` subpath**, layered on top of
  core — never merge it into the root entry.

Add a changeset for every change (`bunx changeset`).
