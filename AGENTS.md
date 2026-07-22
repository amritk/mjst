# AGENTS.md

Guidance for AI coding agents (Cursor, Copilot, Claude Code, …) working **in
this repository**. For Claude Code the same rules live in
[`CLAUDE.md`](./CLAUDE.md); the detailed developer guidelines are in
[`.claude/`](./.claude/) — read the one that matches your task:

- [`.claude/architecture.md`](./.claude/architecture.md) — monorepo structure and design
- [`.claude/typescript.md`](./.claude/typescript.md) — TypeScript style, principles, naming
- [`.claude/bun.md`](./.claude/bun.md) — Bun runtime, APIs, testing, frontend
- [`.claude/testing.md`](./.claude/testing.md) — test setup, style, examples
- [`.claude/comments.md`](./.claude/comments.md) — comment and JSDoc guidelines

> Consuming a published package rather than editing the repo? Each package ships
> an **`AI.md`** next to its `README.md` with a mental model, a minimal example,
> and the gotchas most likely to trip up an LLM. Start there.

## What this is

`mjst` is a **Bun monorepo** of JSON Schema (Draft 2020-12) tooling for
TypeScript: code generators (parsers, validators, types, examples, markdown), a
JSON/YAML linter, a contract-first API layer, and a tiny signals UI layer. Each
`packages/*` directory is an independently published `@amritk/*` package with
its own `AGENTS.md`.

## Workflow

```bash
bun install                 # install workspace deps
bun run build               # build all packages (some tests need runtime-validators built)
bun run test                # run every package's tests
bun run check               # biome lint + format check
bun run check:reactivity    # guard @amritk/mini's compilerless-JSX footgun
bun run types:check         # type-check all packages
```

Per package: `bun run --filter='@amritk/<name>' test` (and `build`, `types:check`).

## House rules

- **Add a changeset with every PR.** Run `bunx changeset`, pick the affected
  packages and a semver bump, commit the file under `.changeset/`. For
  docs/tooling/CI changes that touch no published package, use
  `bunx changeset --empty`.
- **Never** put Claude/session links, tracking IDs, or platform attributions in
  commits or PR text — keep them focused on the code.
- Match the surrounding code's style, comment density, and naming. Biome
  (`biome.json`) is the formatter and linter; run `bun run check` before you're
  done.
- Pre-alpha: breaking changes are allowed but must ride a **minor** version bump
  via a changeset.
