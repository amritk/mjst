# AGENTS.md — @amritk/generate-markdown

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Renders an HTML config-reference table from a `config.schema.json` into a
`README.md`. Used by the CLI package's `generate-readme` script.

## Commands

```bash
bun run --filter='@amritk/generate-markdown' test
bun run --filter='@amritk/generate-markdown' types:check
```

## Invariants — do not break these

- **It does its own filesystem I/O** against fixed paths relative to
  `process.cwd()` (`./config.schema.json` → `./README.md`) and returns `void` —
  unlike the other generators. `generateMarkdown` takes no arguments; keep that
  shape. Pointing the same flow at other paths is `generateConfigTable(options)`,
  which it wraps — new path-taking behaviour belongs there, not in a new
  parameter on `generateMarkdown`.
- **Marker-spliced writes:** only content between `<!-- config-table-start -->`
  and `<!-- config-table-end -->` is replaced. If a README exists but is missing
  a marker, it must **throw** rather than clobber hand-written content — that
  safety check is load-bearing.
- Output is an HTML `<table>` (supports `x-icon` / `x-cli-flag`, plus the
  columns a schema declares for itself in the root `x-extra-columns`), not a
  pipe table. Keep the extension-keyword handling. Every column — declared or
  built-in — is dropped when no property anywhere in the schema fills it, and
  every table in the document shares one set of columns, which is what keeps
  the detail row's `colspan` correct.

Add a changeset for every change (`bunx changeset`).
