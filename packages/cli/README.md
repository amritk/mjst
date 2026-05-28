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
npx mjst --schema ./schema.json --out-dir ./generated
```

> [!NOTE]
> Every flag accepts both kebab-case and camelCase, so `--out-dir` and `--outDir` are equivalent.

### Single file

Pass `--out-file` instead of `--out-dir` to concatenate every generated definition into one
self-contained file. This is currently supported together with `--types-only`:

```bash
npx mjst --schema ./schema.json --out-file ./generated/schema.ts --types-only
```

### Recursive — a whole folder of schemas

Point `--schema-dir` at a directory of JSON Schemas and mjst generates parsers for every
`*.json` file it finds, mirroring the directory layout under `--out-dir`:

```bash
npx mjst --schema-dir ./schemas --out-dir ./generated
```

```
schemas/                  generated/
  user.json        ─▶       user/
  api/                        document.ts, index.ts
    order.json     ─▶       api/order/
                              document.ts, index.ts
                            _helpers/        ← shared runtime helpers (embedded mode)
```

Each schema lands in its own subdirectory so generated files never collide, and in embedded
mode the runtime helpers are emitted **once** into `outDir/_helpers/` — every nested parser
imports from that single shared location. `--build` compiles the whole tree in place.

### Config file

```bash
npx mjst --config ./mjst.config.json
```

> [!NOTE]
> Validate your config against the bundled JSON Schema: [`config.schema.json`](./config.schema.json)

---

## Configuration reference

<!-- config-table-start -->

<a id="config-schema"></a>
### 📄 `schema`

`--schema <path>` · `string`

Path to the schema to process. With the default 'json' input this is a JSON Schema file that is read and parsed. With any other input format it is a JS/TS module that exports a schema, which is loaded and converted to JSON Schema via the matching adapter. Either 'schema' or 'schemaDir' is required.

<a id="config-schemaDir"></a>
### 🗂️ `schemaDir`

`--schema-dir <dir>` · `string`

Path to a directory of JSON Schema files. When set, the CLI walks the directory recursively, generates parsers for every '*.json' schema it finds, and mirrors the directory layout under outDir (each schema lands in its own subdirectory). The runtime helpers are emitted once into a shared outDir/_helpers/ that every nested parser imports from. Mutually exclusive with 'schema'; when both are present 'schemaDir' wins. Only JSON Schema input is supported in this mode.

<a id="config-input"></a>
### 🔌 `input`

`--input <format>` · `string` · Default `"json"`

Source format of the schema. 'json' (default) reads a JSON Schema file directly. Any other format loads 'schema' as a module and converts it to JSON Schema with the matching adapter. Supported: 'typebox', 'zod' (zod v4+), 'valibot' (with @valibot/to-json-schema), and 'effect' — each requires the corresponding library installed in your project.

<a id="config-export"></a>
### 📦 `export`

`--export <name>` · `string`

Which export of the schema module to use when 'input' is not 'json'. Defaults to the default export, or the sole named export when the module has exactly one.

<a id="config-outDir"></a>
### 📁 `outDir`

`--out-dir <dir>` · `string`

Output directory for generated TypeScript files. The directory is created automatically if it does not exist. Subdirectories are created as needed when a generated file includes a nested path. Mutually exclusive with 'outFile'.

<a id="config-outFile"></a>
### 📄 `outFile`

`--out-file <file>` · `string`

Output everything to a single TypeScript file instead of a directory. Every generated definition is concatenated into one self-contained file and the cross-file imports are dropped. Mutually exclusive with 'outDir'. Currently supported only together with 'typesOnly'.

<a id="config-typesOnly"></a>
### 🏷️ `typesOnly`

`--types-only` · `boolean` · Default `false`

Generate only TypeScript type definitions without parser functions. Useful when you only need the type shapes and do not need runtime validation.

<a id="config-build"></a>
### 🔨 `build`

`--build` · `boolean` · Default `false`

Compile the generated TypeScript files to .js and .d.ts output. A temporary tsconfig is written to the output directory, tsc is invoked, and the intermediate .ts source files are removed when compilation succeeds.

<a id="config-logWarnings"></a>
### ⚠️ `logWarnings`

`--log-warnings` · `boolean` · Default `false`

Emit a console.warn in the generated parsers for every input key that is not declared in the schema's properties. Useful for detecting schema drift or unexpected data shapes at runtime.

<a id="config-strict"></a>
### 🚫 `strict`

`--strict` · `boolean` · Default `false`

Generate parsers that throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. Unknown extra keys are still allowed.

<a id="config-readonly"></a>
### 🔒 `readonly`

`--readonly` · `boolean` · Default `false`

Emit every property, array, and record in the generated type definitions as readonly, producing deeply immutable types. Affects type definitions only; the generated parsers still build and return plain objects.

<a id="config-helpers"></a>
### 🧰 `helpers`

`--helpers <mode>` · `string`

Controls how generated parsers reference their runtime helpers. 'package' emits imports from @amritk/helpers (requires it to be installed in the consumer project). 'embedded' ships the helper source under outDir/_helpers/ so the output is self-contained. When omitted, the CLI auto-detects: it picks 'package' if @amritk/helpers resolves from outDir, otherwise 'embedded'.

<a id="config-config"></a>
### ⚙️ `config`

`--config <path>` · `string`

Path to a JSON config file. Keys match the option names in this schema (schema, schemaDir, outDir, outFile, typesOnly, build, logWarnings, strict, readonly, helpers). CLI flags take precedence over config file values.

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
