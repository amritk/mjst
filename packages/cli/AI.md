# @amritk/mjst (the `mjst` CLI) — notes for AI coding agents

The command-line entry point to mjst: generate TypeScript parsers, validators,
and types from JSON Schema, plus `lint` and `compile-api` subcommands. Full
reference is [README.md](./README.md); config options are in
[config.schema.json](./config.schema.json).

> Pre-alpha: generated output and flags change without notice pre-1.0. This
> package ships **only a `mjst` binary** — there are no JS exports. For the
> programmatic API import `@amritk/generate-parsers` etc. instead.

## The three commands

```bash
# 1. Codegen (default command)
mjst --schema ./schema.json --out-dir ./generated

# 2. Lint JSON/YAML against JSON Schema + style rules
mjst lint "**/*.{yaml,json}" -r .lint.yaml

# 3. Compile an @amritk/api routes module to a fused, eval-free handler
mjst compile-api ./routes.ts --out ./dist/handler.ts
```

## Codegen gotchas

1. **You must pass an output.** `--out-dir <dir>` **or** `--out-file <file>` —
   omitting both errors. `--out-file` only works with `--types-only`.
2. **`--import-ext` defaults to `ts`, not `js`.** Generated imports carry literal
   `.ts` extensions, so plain `tsc` needs `allowImportingTsExtensions`. Use
   `--import-ext js` or `--build` for directly-compilable output.
   `--import-ext ts` + `--build` is a hard error.
3. **Flags accept kebab or camel** (`--out-dir` ≡ `--outDir`). **Config-file
   keys are camelCase** (`outDir`, `schemaDir`, `typesOnly`, …), validated
   against `config.schema.json`. CLI flags always override the config file.
4. **The root type name comes from the schema `title`/filename**, not
   `Document`. Override with `--root-type <name>` (single-schema only; rejected
   with `--schema-dir`).
5. **Non-JSON input** (`--input typebox|zod|valibot|effect`) works for a single
   `--schema`; `--schema-dir` only accepts `json`.

## Common flags

`--schema` / `--schema-dir`, `--out-dir` / `--out-file`, `--input`,
`--validators`, `--examples`, `--types-only`, `--build`, `--strict`,
`--strip-unknown`, `--readonly`, `--import-ext ts|js`, `--config <path>`,
`--resolve-remote` / `--allowed-hosts` (SSRF-guarded remote `$ref`s).

## Lint gotchas

- `-F`/`--fail-severity` (default `error`) sets the exit-code threshold
  (`0` clean, `1` findings at/above threshold, `2` usage error).
- With no `-r`, a `.lint.{yaml,yml,json,js,mjs}` ruleset is auto-discovered by
  walking up from each file.

Install: `bun add -d @amritk/mjst` (or `npx mjst …`).
