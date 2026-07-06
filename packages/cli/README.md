<div align="center">

# @amritk/mjst

**Generate TypeScript parsers and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

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
<table>
<thead>
<tr>
<th>Property</th>
<th>CLI Flag</th>
<th>Type</th>
<th align="center">Default</th>
</tr>
</thead>
<tbody>
<tr>
<td>📄 <code>schema</code></td>
<td><code>--schema &lt;path&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Path to the schema to process. With the default 'json' input this is a JSON Schema file that is read and parsed. With any other input format it is a JS/TS module that exports a schema, which is loaded and converted to JSON Schema via the matching adapter. Either 'schema' or 'schemaDir' is required.<br><strong>Examples:</strong> <code>"./schema.json"</code></td>
</tr>
<tr>
<td>🗂️ <code>schemaDir</code></td>
<td><code>--schema-dir &lt;dir&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Path to a directory of JSON Schema files. When set, the CLI walks the directory recursively, generates parsers for every '*.json' schema it finds, and mirrors the directory layout under outDir (each schema lands in its own subdirectory). The runtime helpers are emitted once into a shared outDir/_helpers/ that every nested parser imports from. Mutually exclusive with 'schema'; when both are present 'schemaDir' wins. Only JSON Schema input is supported in this mode.<br><strong>Examples:</strong> <code>"./schemas"</code></td>
</tr>
<tr>
<td>🔌 <code>input</code></td>
<td><code>--input &lt;format&gt;</code></td>
<td><code>string</code></td>
<td align="center"><code>"json"</code></td>
</tr>
<tr>
<td colspan="4">Source format of the schema. 'json' (default) reads a JSON Schema file directly. Any other format loads 'schema' as a module and converts it to JSON Schema with the matching adapter. Supported: 'typebox', 'zod' (zod v4+), 'valibot' (with @valibot/to-json-schema), and 'effect' — each requires the corresponding library installed in your project.<br><strong>Allowed:</strong> <code>"json"</code>, <code>"typebox"</code>, <code>"zod"</code>, <code>"valibot"</code>, <code>"effect"</code></td>
</tr>
<tr>
<td>📦 <code>export</code></td>
<td><code>--export &lt;name&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Which export of the schema module to use when 'input' is not 'json'. Defaults to the default export, or the sole named export when the module has exactly one.</td>
</tr>
<tr>
<td>📁 <code>outDir</code></td>
<td><code>--out-dir &lt;dir&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Output directory for generated TypeScript files. The directory is created automatically if it does not exist. Subdirectories are created as needed when a generated file includes a nested path. Mutually exclusive with 'outFile'.<br><strong>Examples:</strong> <code>"./generated"</code></td>
</tr>
<tr>
<td>📄 <code>outFile</code></td>
<td><code>--out-file &lt;file&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Output everything to a single TypeScript file instead of a directory. Every generated definition is concatenated into one self-contained file and the cross-file imports are dropped. Mutually exclusive with 'outDir'. Currently supported only together with 'typesOnly'.<br><strong>Examples:</strong> <code>"./generated/schema.ts"</code></td>
</tr>
<tr>
<td>🏷️ <code>typesOnly</code></td>
<td><code>--types-only</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="4">Generate only TypeScript type definitions without parser functions. Useful when you only need the type shapes and do not need runtime validation.</td>
</tr>
<tr>
<td>🔨 <code>build</code></td>
<td><code>--build</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="4">Compile the generated TypeScript files to .js and .d.ts output. A temporary tsconfig is written to the output directory, tsc is invoked, and the intermediate .ts source files are removed when compilation succeeds.</td>
</tr>
<tr>
<td>⚠️ <code>logWarnings</code></td>
<td><code>--log-warnings</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="4">Emit a console.warn in the generated parsers for every input key that is not declared in the schema's properties. Useful for detecting schema drift or unexpected data shapes at runtime.</td>
</tr>
<tr>
<td>🚫 <code>strict</code></td>
<td><code>--strict</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="4">Generate parsers that throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. When a schema sets additionalProperties: false, undeclared keys throw too; otherwise they are still allowed.</td>
</tr>
<tr>
<td>🧹 <code>stripUnknown</code></td>
<td><code>--strip-unknown</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="4">Build each parser's result from the schema's declared properties only, silently dropping undeclared input keys at every nesting level (zod's .strip()). Extras are never a validation error, so this composes with strict (which still throws on wrong types and missing required properties) and yields to additionalProperties: false, which rejects rather than strips in strict mode.</td>
</tr>
<tr>
<td>🔒 <code>readonly</code></td>
<td><code>--readonly</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="4">Emit every property, array, and record in the generated type definitions as readonly, producing deeply immutable types. Affects type definitions only; the generated parsers still build and return plain objects.</td>
</tr>
<tr>
<td>🧰 <code>helpers</code></td>
<td><code>--helpers &lt;mode&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Controls how generated parsers reference their runtime helpers. 'package' emits imports from @amritk/helpers (requires it to be installed in the consumer project). 'embedded' ships the helper source under outDir/_helpers/ so the output is self-contained. When omitted, the CLI auto-detects: it picks 'package' if @amritk/helpers resolves from outDir, otherwise 'embedded'.<br><strong>Allowed:</strong> <code>"package"</code>, <code>"embedded"</code></td>
</tr>
<tr>
<td>🏷️ <code>typeSuffix</code></td>
<td><code>--type-suffix &lt;suffix&gt;</code></td>
<td><code>string</code></td>
<td align="center"><code>""</code></td>
</tr>
<tr>
<td colspan="4">Suffix appended to every generated type name derived from a $ref (e.g. 'Object' turns Contact into ContactObject). Defaults to no suffix. The root type name is used verbatim and is unaffected.</td>
</tr>
<tr>
<td>🔗 <code>importExt</code></td>
<td><code>--import-ext &lt;ext&gt;</code></td>
<td><code>string</code></td>
<td align="center"><code>"js"</code></td>
</tr>
<tr>
<td colspan="4">Extension emitted on every relative import specifier in the generated output (cross-file $ref imports, the index barrel, and embedded-helper imports). 'js' (default) is the standard TS NodeNext form ('./x.js' resolving to a sibling x.ts), accepted by tsc, Bun, and bundlers, and required by 'build'. 'ts' emits the literal on-disk paths so the generated .ts sources run directly under Node's type stripping (Node 22.6+ with --experimental-strip-types, on by default from Node 23). Incompatible with 'build' — tsc refuses to emit from .ts specifiers.<br><strong>Allowed:</strong> <code>"js"</code>, <code>"ts"</code></td>
</tr>
<tr>
<td>⚙️ <code>config</code></td>
<td><code>--config &lt;path&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Path to a JSON config file. Keys match the option names in this schema (schema, schemaDir, outDir, outFile, typesOnly, build, logWarnings, strict, readonly, helpers, typeSuffix, importExt). CLI flags take precedence over config file values.<br><strong>Examples:</strong> <code>"./mjst.config.json"</code></td>
</tr>
</tbody>
</table>
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
