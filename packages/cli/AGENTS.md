# AGENTS.md — @amritk/mjst (CLI)

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the CLI instead? See
[`AI.md`](./AI.md).

The `mjst` binary: codegen (default), `lint`, and `compile-api` subcommands. It
composes the `@amritk/generate-*`, `@amritk/lint`, and `@amritk/api` packages.

## Commands

```bash
bun run --filter='@amritk/mjst' test
bun run dev -- --schema ./fixtures/… --out-dir /tmp/out   # run the CLI from source
bun run --filter='@amritk/mjst' generate-readme            # after editing config.schema.json
```

## Invariants — do not break these

- **Ships only a `bin`** — no JS exports. New programmatic capability belongs in
  the relevant library package, then wired into a command here.
- **`config.schema.json` is the source of truth** for the config-file options
  AND the README config table. After editing it, run `generate-readme`
  (`@amritk/generate-markdown`) so the README table stays in sync — CI/humans
  expect them to match.
- **Flags accept both kebab and camel case**; config-file keys are camelCase.
  CLI flags always override the config file. Keep that precedence.
- Command dispatch lives in `src/cli.ts`; `lint` and `compile-api` delegate to
  `src/lint/run.ts` and `src/compile-api/run.ts`.
- Guard flag combinations explicitly with actionable errors (e.g.
  `--import-ext ts` + `--build` is rejected) rather than letting them fail
  downstream.

Add a changeset for every change (`bunx changeset`).
