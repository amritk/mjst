<div align="center">

# @amritk/generate-markdown

**Generate markdown documentation from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-100%25-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-markdown` renders a configuration reference table from a `config.schema.json` file and writes the result to `README.md`. It exists so the documentation for a CLI's flags can be regenerated from the schema itself, keeping the two in sync.

For every property it reads the standard JSON Schema keywords:

- `type` — shown in the **Type** column
- `description` — the first paragraph fills the full-width detail row
- `default` — shown (quoted/JSON-encoded) in the **Default** column
- `enum` — listed as **Allowed:** values in the detail row
- `examples` — listed as **Examples:** values in the detail row
- `required` — the parent's `required` array drives the **Required** column

…plus two non-standard keywords for richer output:

- `x-cli-flag` — the matching CLI flag (e.g. `--schema <path>`), shown in the **CLI Flag** column
- `x-icon` — an emoji shown next to the property name

Columns and icons are only rendered when the schema actually uses them. The
**CLI Flag**, **Required**, and **Default** columns are each dropped entirely
when no property anywhere in the schema fills them, and a property with no
`x-icon` simply shows no icon. There are no `—` placeholders: a cell with
nothing to say is left empty. The check spans the whole schema (including
nested objects), so every table keeps the same set of columns.

Object properties with their own `properties` are linked to a nested detail table rendered below the main one.

---

## Installation

```bash
npm install @amritk/generate-markdown
# or
pnpm add @amritk/generate-markdown
# or
yarn add @amritk/generate-markdown
# or
bun add @amritk/generate-markdown
```

---

## Usage

```ts
import { generateMarkdown } from '@amritk/generate-markdown'

await generateMarkdown()
// Reads ./config.schema.json from process.cwd()
// Writes ./README.md
```

If `README.md` already exists and contains the marker comments below, only the content between them is replaced — everything else in the file is preserved:

```md
<!-- config-table-start -->
<!-- config-table-end -->
```

Without markers (or without an existing README) the file is overwritten with just the table.

---

## Examples

Each example below shows an input `config.schema.json` and the markdown `generateMarkdown()` produces from it.

### Defaults of every type

Defaults are rendered in the **Default** column. Strings are quoted; numbers and booleans are printed bare; objects and arrays are JSON-encoded. None of these properties use a CLI flag or are required, so those columns are dropped — only **Property**, **Type**, and **Default** remain.

<details>
<summary><strong>Input schema</strong></summary>

```json
{
  "title": "Defaults",
  "properties": {
    "outDir":  { "type": "string",  "default": "./generated", "x-icon": "📁", "description": "Output directory." },
    "port":    { "type": "number",  "default": 8080, "x-icon": "🔌", "description": "Port to listen on." },
    "minify":  { "type": "boolean", "default": false, "x-icon": "🗜️", "description": "Minify the output." },
    "include": { "type": "array",   "default": ["**/*.ts"], "x-icon": "📥", "description": "Glob patterns to include." },
    "env":     { "type": "object",  "default": { "NODE_ENV": "production" }, "x-icon": "🌱", "description": "Environment variables." }
  }
}
```

</details>

Generated markdown:

<table>
<thead>
<tr>
<th>Property</th>
<th>Type</th>
<th align="center">Default</th>
</tr>
</thead>
<tbody>
<tr>
<td>📁 <code>outDir</code></td>
<td><code>string</code></td>
<td align="center"><code>"./generated"</code></td>
</tr>
<tr>
<td colspan="3">Output directory.</td>
</tr>
<tr>
<td>🔌 <code>port</code></td>
<td><code>number</code></td>
<td align="center"><code>8080</code></td>
</tr>
<tr>
<td colspan="3">Port to listen on.</td>
</tr>
<tr>
<td>🗜️ <code>minify</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Minify the output.</td>
</tr>
<tr>
<td>📥 <code>include</code></td>
<td><code>array</code></td>
<td align="center"><code>["**/*.ts"]</code></td>
</tr>
<tr>
<td colspan="3">Glob patterns to include.</td>
</tr>
<tr>
<td>🌱 <code>env</code></td>
<td><code>object</code></td>
<td align="center"><code>{"NODE_ENV":"production"}</code></td>
</tr>
<tr>
<td colspan="3">Environment variables.</td>
</tr>
</tbody>
</table>

### Enums and examples

`enum` becomes an **Allowed:** line and `examples` becomes an **Examples:** line, both appended to the property's detail row beneath the description.

<details>
<summary><strong>Input schema</strong></summary>

```json
{
  "title": "Input",
  "required": ["input"],
  "properties": {
    "input": {
      "type": "string",
      "enum": ["json", "zod", "typebox"],
      "default": "json",
      "x-cli-flag": "--input <format>",
      "x-icon": "🔌",
      "description": "Source format of the schema.",
      "examples": ["json", "zod"]
    }
  }
}
```

</details>

Generated markdown:

<table>
<thead>
<tr>
<th>Property</th>
<th>CLI Flag</th>
<th>Type</th>
<th align="center">Required</th>
<th align="center">Default</th>
</tr>
</thead>
<tbody>
<tr>
<td>🔌 <code>input</code></td>
<td><code>--input &lt;format&gt;</code></td>
<td><code>string</code></td>
<td align="center">✅</td>
<td align="center"><code>"json"</code></td>
</tr>
<tr>
<td colspan="5">Source format of the schema.<br><strong>Allowed:</strong> <code>"json"</code>, <code>"zod"</code>, <code>"typebox"</code><br><strong>Examples:</strong> <code>"json"</code>, <code>"zod"</code></td>
</tr>
</tbody>
</table>

### Required properties and CLI flags

A property name appears in the **Required** column (✅) when it is listed in the object's `required` array. `x-cli-flag` fills the **CLI Flag** column, and `x-icon` sits next to the name. Neither property sets a `default`, so the **Default** column is dropped; the `outFile` row, which isn't required, leaves the **Required** cell empty rather than printing a placeholder.

<details>
<summary><strong>Input schema</strong></summary>

```json
{
  "title": "RequiredFlags",
  "required": ["schema"],
  "properties": {
    "schema":  { "type": "string", "x-cli-flag": "--schema <path>", "x-icon": "📄", "description": "Path to the schema to process.", "examples": ["./schema.json"] },
    "outFile": { "type": "string", "x-cli-flag": "--out-file <file>", "x-icon": "📄", "description": "Write everything to a single file." }
  }
}
```

</details>

Generated markdown:

<table>
<thead>
<tr>
<th>Property</th>
<th>CLI Flag</th>
<th>Type</th>
<th align="center">Required</th>
</tr>
</thead>
<tbody>
<tr>
<td>📄 <code>schema</code></td>
<td><code>--schema &lt;path&gt;</code></td>
<td><code>string</code></td>
<td align="center">✅</td>
</tr>
<tr>
<td colspan="4">Path to the schema to process.<br><strong>Examples:</strong> <code>"./schema.json"</code></td>
</tr>
<tr>
<td>📄 <code>outFile</code></td>
<td><code>--out-file &lt;file&gt;</code></td>
<td><code>string</code></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Write everything to a single file.</td>
</tr>
</tbody>
</table>

### Nested objects

An object property that declares its own `properties` is linked to a detail table rendered below the main one. The nested table uses the object's own `required` array, so required markers are scoped to each level.

<details>
<summary><strong>Input schema</strong></summary>

```json
{
  "title": "Nested",
  "properties": {
    "server": {
      "type": "object",
      "x-icon": "🖥️",
      "description": "HTTP server settings.",
      "required": ["host"],
      "properties": {
        "host": { "type": "string", "x-icon": "🌐", "description": "Hostname to bind." },
        "port": { "type": "number", "x-icon": "🔌", "default": 3000, "description": "Port to listen on." }
      }
    }
  }
}
```

</details>

Generated markdown:

<table>
<thead>
<tr>
<th>Property</th>
<th>Type</th>
<th align="center">Required</th>
<th align="center">Default</th>
</tr>
</thead>
<tbody>
<tr>
<td>🖥️ <a href="#config-server"><code>server</code></a></td>
<td><code>object</code></td>
<td align="center"></td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">HTTP server settings.</td>
</tr>
</tbody>
</table>

<a id="config-server"></a>
#### `server`

<table>
<thead>
<tr>
<th>Property</th>
<th>Type</th>
<th align="center">Required</th>
<th align="center">Default</th>
</tr>
</thead>
<tbody>
<tr>
<td>🌐 <code>host</code></td>
<td><code>string</code></td>
<td align="center">✅</td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">Hostname to bind.</td>
</tr>
<tr>
<td>🔌 <code>port</code></td>
<td><code>number</code></td>
<td align="center"></td>
<td align="center"><code>3000</code></td>
</tr>
<tr>
<td colspan="4">Port to listen on.</td>
</tr>
</tbody>
</table>

---

## API

### `generateMarkdown(): Promise<void>`

No arguments. Reads from `${cwd}/config.schema.json` and writes to `${cwd}/README.md`.

---

## Related packages

- [`@amritk/mjst`](../cli) — uses this package to keep its README's flag table in sync with `config.schema.json`
- [`@amritk/generate-parsers`](../generate-parsers) — sibling generator for TypeScript parsers and types
- [`@amritk/generate-validators`](../generate-validators) — sibling generator for predicate validators

---

## License

[MIT](../../LICENSE)
