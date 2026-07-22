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
  unlike the other generators. `generateMarkdown` takes no arguments; keep the
  single-export surface.
- **Marker-spliced writes:** only content between `<!-- config-table-start -->`
  and `<!-- config-table-end -->` is replaced. If a README exists but is missing
  a marker, it must **throw** rather than clobber hand-written content — that
  safety check is load-bearing.
- Output is an HTML `<table>` (supports `x-icon` / `x-cli-flag` extension
  columns), not a pipe table. Keep the extension-keyword handling.

Add a changeset for every change (`bunx changeset`).
