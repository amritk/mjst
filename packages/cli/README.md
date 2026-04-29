<div align="center">

# @amritk/cli

**Generate TypeScript parsers and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp; ![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp; ![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp; ![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp; ![bun](https://img.shields.io/badge/bun-required-FBF0DF?style=flat-square&logo=bun&logoColor=000000)

</div>

---

## Overview

Generate TypeScript parsers and type definitions from JSON Schemas.

You can supply options via CLI flags or a JSON config file. CLI flags always take precedence over config file values.

---

## Installation

```zsh
bun install
```

---

## Usage

### CLI

```bash
mjst --schema ./schema.json --outDir ./generated
```

### Config File

```bash
mjst --config ./mjst-cli.config.json
```

> [!NOTE]
> Validate your config against the bundled JSON Schema: [`config.schema.json`](./fixtures/config.schema.json)

---

## Flags

| Flag | Type | Required | Description |
|:---|:---:|:---:|:---|
| `--schema <path>` | `string` | ✅ | Path to the JSON Schema file to process. |
| `--outDir <dir>` | `string` | ✅ | Output directory for generated files. Created automatically if it does not exist. |
| `--types-only` | `boolean` | — | Generate only TypeScript type definitions without parser functions. |
| `--docs <path>` | `string` | — | Path to a markdown documentation file used to enrich generated type comments. |
| `--build` | `boolean` | — | Compile generated TypeScript to `.js` and `.d.ts` files. The intermediate `.ts` files are removed after compilation. |
| `--config <path>` | `string` | — | Path to a JSON config file. Keys match option names. CLI flags take precedence. |

---

## Configuration Reference

| | Property | CLI Flag | Type | Required | Default | Description |
|:---:|:---|:---|:---:|:---:|:---:|:---|
| 📄 | `schema` | `--schema <path>` | `string` | ✅ | — | Path to the JSON Schema file to process. The schema is read, parsed, and used to generate TypeScript source files. |
| 📁 | `outDir` | `--outDir <dir>` | `string` | ✅ | — | Output directory for generated TypeScript files. The directory is created automatically if it does not exist. Subdirectories are created as needed when a generated file includes a nested path. |
| 🏷️ | `typesOnly` | `--types-only` | `boolean` | — | `false` | Generate only TypeScript type definitions without parser functions. Useful when you only need the type shapes and do not need runtime validation. |
| 📝 | `docs` | `--docs <path>` | `string` | — | — | Path to a markdown documentation file. When provided, the content is used to enrich comments on the generated TypeScript types. |
| 🔨 | `build` | `--build` | `boolean` | — | `false` | Compile the generated TypeScript files to `.js` and `.d.ts` output. A temporary `tsconfig` is written to the output directory, `tsc` is invoked, and the intermediate `.ts` source files are removed when compilation succeeds. |
| ⚙️ | `config` | `--config <path>` | `string` | — | — | Path to a JSON config file. Keys match the option names in this table (`schema`, `outDir`, `typesOnly`, `docs`). CLI flags take precedence over config file values. |

---

## Config File Examples

**Minimal — generate parsers and types**
```json
{
  "schema": "./schema.json",
  "outDir": "./generated"
}
```

**Types only — skip parser functions**
```json
{
  "schema": "./schema.json",
  "outDir": "./generated",
  "typesOnly": true
}
```

**With documentation — enrich type comments from markdown**
```json
{
  "schema": "./schema.json",
  "outDir": "./generated",
  "docs": "./docs/schema.md"
}
```

---

## How It Works

1. **`schema`** via `--schema <path>` — Path to the JSON Schema file to process
2. **`outDir`** via `--outDir <dir>` — Output directory for generated TypeScript files
3. **`typesOnly`** _(optional)_ via `--types-only` — Generate only TypeScript type definitions without parser functions
4. **`docs`** _(optional)_ via `--docs <path>` — Path to a markdown documentation file to enrich generated type comments
5. **`build`** _(optional)_ via `--build` — Compile generated `.ts` files to `.js` and `.d.ts`, then remove the source `.ts` files
6. **`config`** _(optional)_ via `--config <path>` — Path to a JSON config file

---

## Scripts

| Script | Command |
|:---|:---|
| `bun run dev` | `bun run --conditions=development ./src/cli.ts` |
| `bun run start` | `bun run ./src/cli.ts` |
| `bun run generate-readme` | `bun run ./src/cli.ts --markdown` |

---

<div align="center">

README generated from [`config.schema.json`](./fixtures/config.schema.json) &nbsp;·&nbsp; run `bun run generate-readme` to update

</div>
