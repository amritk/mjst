# AGENTS.md — @amritk/yaml

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

A fast, zero-dependency YAML parser for OpenAPI tooling with exact source
positions on every node.

## Commands

```bash
bun run --filter='@amritk/yaml' test
bun run --filter='@amritk/yaml' types:check
```

## Invariants — do not break these

- **Zero dependencies.** Keep it that way — this is a deliberately small,
  dependency-free parser.
- **Every node carries inline `start` / `end` char offsets**, `end` exclusive.
  Diagnostics rely on these; don't switch to a `range` tuple or lose positions.
- **YAML 1.2 core scalar resolution:** `version: 1.0.0` stays the string
  `"1.0.0"`. This is intentional for OpenAPI round-trip safety — don't "helpfully"
  coerce.
- **Errors are collected on `doc.errors` / `doc.warnings`, not thrown.**
  `parseDocument` = first document only; `parseAllDocuments` for `---` streams.
- This is a documented **subset**, not full YAML 1.2 conformance — scope new
  features against tooling needs, not spec completeness.

Add a changeset for every change (`bunx changeset`).
