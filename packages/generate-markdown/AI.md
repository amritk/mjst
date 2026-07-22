# @amritk/generate-markdown — notes for AI coding agents

Programmatic API: render an HTML config-reference table from a
`config.schema.json` into a `README.md`, keeping flag docs in sync with the
schema. Full reference is [README.md](./README.md).

> Pre-alpha: APIs change pre-1.0. This is an internal tooling package — most
> users never call it directly.

## The whole API

```ts
import { generateMarkdown } from '@amritk/generate-markdown'

// Takes NO arguments. Reads ./config.schema.json from process.cwd() and
// writes ./README.md. Run it from the target package's directory.
await generateMarkdown()
```

## Gotchas — where agents fail

1. **It does its own filesystem I/O and takes no arguments.** Unlike the other
   generators it does **not** accept a schema object or return `GeneratedFile[]`
   — it reads a fixed `./config.schema.json` and writes `./README.md`, both
   relative to `process.cwd()`, and returns `void`.
2. **It splices between markers.** If `README.md` exists but lacks BOTH
   `<!-- config-table-start -->` and `<!-- config-table-end -->`, it **throws**
   rather than overwrite hand-written content. Only the content between the
   markers is replaced.
3. **Output is an HTML `<table>`**, not a GitHub-flavored pipe table (so it can
   carry `x-icon` / `x-cli-flag` extension columns).

Only the `.` entry (`generateMarkdown`). Install: `bun add @amritk/generate-markdown`.
