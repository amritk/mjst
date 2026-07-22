# AGENTS.md — @amritk/mini

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md) and [`../../CLAUDE.md`](../../CLAUDE.md).
Consuming the package instead? See [`AI.md`](./AI.md).

A deliberately tiny signals UI layer: reactive DOM bindings + a compilerless JSX
runtime built on alien-signals.

## Commands

```bash
bun run --filter='@amritk/mini' test
bun run check:reactivity   # the footgun guard (also ships as the @amritk/mini/vite plugin)
bun run --filter='@amritk/mini' types:check
```

## Invariants — do not break these

- **The cap is the design.** No virtual DOM, no diffing, no re-render. JSX builds
  real DOM once; dynamic values flow through bind helpers or function-valued
  props; repetition goes through `list`. If a feature seems missing, the answer
  is usually "use Preact/Solid", **not** a new helper. Adding surface area needs
  a strong justification.
- **Reactivity is decided by value shape at runtime:** a function-valued
  attribute/child/`show` is reactive; anything else is static. The classic bug is
  calling a signal in JSX (`disabled={streaming()}`) — the `@amritk/mini/vite`
  plugin guards it live in the dev server, and `check:reactivity` runs the same
  check in CI. If you add a `.tsx` test that intentionally freezes a signal, mark
  the line `// mini-static-ok`.
- **`bindHtml` is the only `innerHTML` sink**, and its `sanitize` argument is
  required at every call site — never add a default. Everything else writes
  through `textContent` / attributes / `classList`.
- **Subpaths (`router`/`flow`/`forms`/`query`) must add zero bytes to the `.`
  entry.** `forms`' schema arm and `query` depend on **optional** peers
  (`@amritk/runtime-validators`, `@tanstack/query-core`) — keep them optional.
- This package **ships its `src/`** too (see `files`), so source comments are
  shipped — keep them accurate.

Add a changeset for every change (`bunx changeset`).
