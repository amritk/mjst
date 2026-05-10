# Tooling

The repo uses Node.js, pnpm, vitest, and tsup.

- Use `node <file>` (or `tsx <file>` for `.ts` source) — never `bun <file>`.
- Use `pnpm install` / `pnpm add` / `pnpm run <script>`.
- Use `pnpm test` (vitest) — do not use `jest` or `bun test`.
- Use `tsup` to build packages (esbuild under the hood).
- Use `npx <package>` or `pnpx <package>` to run dependency CLIs without installing globally.

## Versions

- Node ≥ 20 (CI uses 22)
- pnpm ≥ 9
- TypeScript ^5

## File system / shell APIs

Stick to Node built-ins. No `Bun.*` APIs.

- `node:fs/promises` for `readFile`, `writeFile`, `mkdir`, `cp`, `unlink`, etc.
- `node:path` and `node:url` (`fileURLToPath(import.meta.url)`) for path resolution. Do **not** use `import.meta.dir` — that's a Bun extension.
- `node:child_process` (`execFile`, `spawn`) for shelling out. Do **not** use `Bun.$\`...\``.
- `node:module` `createRequire(import.meta.url)` if you need `require.resolve` from an ESM module.

## Workspaces and catalogs

This is a pnpm workspace. The list of packages and the shared dependency catalog live in `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'

catalog:
  json-schema-typed: ^8.0.1
```

Reference catalog entries from a workspace package via `"<dep>": "catalog:"`. Cross-package deps use `"@amritk/<pkg>": "workspace:*"`.

## Scripts

Each publishable package exposes:

- `pnpm run build` — `tsup` (writes ESM JS + `.d.ts` to `dist/`)
- `pnpm run typecheck` — `tsc -p .`

Tests run from the repo root with `pnpm test` (vitest reads `vitest.config.ts`).
