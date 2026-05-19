<div align="center">

# @amritk/mjst

**Generate TypeScript parsers and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-24%25-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/mjst` is the command-line entry point for [mjst](../../README.md). Point it at a JSON Schema and it produces TypeScript parsers, validators, and type definitions in the directory of your choice.

Options can be supplied via CLI flags or a JSON config file. **CLI flags always take precedence over config file values.**

---

## Installation

```bash
npm install --save-dev @amritk/mjst
# or
pnpm add -D @amritk/mjst
# or
yarn add -D @amritk/mjst
# or
bun add -d @amritk/mjst
```

The package ships a `mjst` bin that runs under Node ≥ 20 (or Bun), so you can invoke it via `npx mjst`, `pnpm dlx mjst`, `yarn dlx mjst`, `bunx mjst`, or as a script in `package.json`.

---

## Usage

### CLI

```bash
npx mjst --schema ./schema.json --outDir ./generated
```

### Config file

```bash
npx mjst --config ./mjst.config.json
```

> [!NOTE]
> Validate your config against the bundled JSON Schema: [`config.schema.json`](./config.schema.json)

---

## Configuration reference

<!-- config-table-start -->
| | Property | CLI Flag | Type | Required | Default | Description |
|:---:|:---|:---|:---:|:---:|:---:|:---|
| 📄 | `schema` | `--schema <path>` | `string` | ✅ | — | Path to the JSON Schema file to process. The schema is read, parsed, and used to generate TypeScript source files. |
| 📁 | `outDir` | `--outDir <dir>` | `string` | ✅ | — | Output directory for generated TypeScript files. The directory is created automatically if it does not exist. Subdirectories are created as needed when a generated file includes a nested path. |
| 🏷️ | `typesOnly` | `--types-only` | `boolean` | — | `false` | Generate only TypeScript type definitions without parser functions. Useful when you only need the type shapes and do not need runtime validation. |
| 🔨 | `build` | `--build` | `boolean` | — | `false` | Compile the generated TypeScript files to .js and .d.ts output. A temporary tsconfig is written to the output directory, tsc is invoked, and the intermediate .ts source files are removed when compilation succeeds. |
| ⚠️ | `logWarnings` | `--log-warnings` | `boolean` | — | `false` | Emit a console.warn in the generated parsers for every input key that is not declared in the schema's properties. Useful for detecting schema drift or unexpected data shapes at runtime. |
| 🚫 | `strict` | `--strict` | `boolean` | — | `false` | Generate parsers that throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. Unknown extra keys are still allowed. |
| 🧰 | `helpers` | `--helpers <mode>` | `string` | — | — | Controls how generated parsers reference their runtime helpers. 'package' emits imports from @amritk/helpers (requires it to be installed in the consumer project). 'embedded' ships the helper source under outDir/_helpers/ so the output is self-contained. When omitted, the CLI auto-detects: it picks 'package' if @amritk/helpers resolves from outDir, otherwise 'embedded'. |
| ⚙️ | `config` | `--config <path>` | `string` | — | — | Path to a JSON config file. Keys match the option names in this schema (schema, outDir, typesOnly, build, logWarnings, strict, helpers). CLI flags take precedence over config file values. |
<!-- config-table-end -->

---

## Config file examples

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

**Build — emit `.js` and `.d.ts` instead of `.ts`**

```json
{
  "schema": "./schema.json",
  "outDir": "./generated",
  "build": true
}
```

**Log warnings — warn on unknown input properties**

```json
{
  "schema": "./schema.json",
  "outDir": "./generated",
  "logWarnings": true
}
```

---

## Scripts

| Script | Command |
|:---|:---|
| `bun run dev` | `bun run --conditions=development ./src/cli.ts` |
| `bun run start` | `bun run ./src/cli.ts` |
| `bun run build` | `bun run build:code && bun run build:types` |
| `bun run generate-readme` | `bun run generate-readme` |

---

## License

[MIT](../../LICENSE)
