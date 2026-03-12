<div align="center">

# @mjst/cli

**Generate TypeScript parsers and type definitions from JSON Schemas.**

![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp; ![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp; ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)&nbsp; ![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp; ![pnpm](https://img.shields.io/badge/pnpm-required-F69220?style=flat-square&logo=pnpm&logoColor=white)

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

You can supply options via CLI flags or a JSON config file. CLI flags always take precedence over config file values.

```bash
mjst --config ./@mjst/cli.config.json
```

> [!NOTE]
> Validate your config against the bundled JSON Schema: [`config.schema.json`](./fixtures/config.schema.json)

---

## Configuration Reference

| | Property | CLI Flag | Type | Required | Default | Description |
|:---:|:---|:---|:---:|:---:|:---:|:---|
| 📄 | `schema` | `--schema <path>` | `string` | ✅ | — | Path to the JSON Schema file to process. The schema is read, parsed, and used to generate TypeScript source files. |
| 📁 | `outDir` | `--outDir <dir>` | `string` | ✅ | — | Output directory for generated TypeScript files. The directory is created automatically if it does not exist. Subdirectories are created as needed when a generated file includes a nested path. |
| 🏷️ | `typesOnly` | `--types-only` | `boolean` | — | `false` | Generate only TypeScript type definitions without parser functions. Useful when you only need the type shapes and do not need runtime validation. |
| ⚙️ | `config` | `--config <path>` | `string` | — | — | Path to a JSON config file. Keys match the option names in this schema (schema, outDir, typesOnly). CLI flags take precedence over config file values. |

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

---

## How It Works

1. **`schema`** via `--schema <path>` — Path to the JSON Schema file to process
2. **`outDir`** via `--outDir <dir>` — Output directory for generated TypeScript files
3. **`typesOnly`** _(optional)_ via `--types-only` — Generate only TypeScript type definitions without parser functions
4. **`config`** _(optional)_ via `--config <path>` — Path to a JSON config file

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
