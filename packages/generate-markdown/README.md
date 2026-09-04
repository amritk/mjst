<div align="center">

# @amritk/generate-markdown

**Generate markdown documentation from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/generate-markdown?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-markdown` turns a `config.schema.json` into documentation, so
the docs for a config cannot drift from the schema that validates it. It renders
two shapes:

| Shape | Entry point | Output |
| --- | --- | --- |
| **Config table** | `generateMarkdown()` | One HTML `<table>`, spliced into an existing `README.md` between marker comments |
| **Prose reference** | `generateMarkdownFiles(schema, options?)` | A heading, a **Type:**, the description and an example per property — across as many markdown files as the schema declares |

The table is the compact form for a CLI's flags. The prose reference is the form
a hand-written configuration guide takes, and it is documented under
[Prose reference](#prose-reference) below.

### Config table

For every property it reads the standard JSON Schema keywords:

- `type` — shown in the **Type** column
- `description` — the first paragraph fills the full-width detail row
- `default` — shown (quoted/JSON-encoded) in the **Default** column
- `enum` — listed as **Allowed:** values in the detail row
- `examples` — listed as **Examples:** values in the detail row
- `required` — the parent's `required` array drives the **Required** column

Schemas built from references work too. `$ref` pointers are resolved against the
document's `$defs` (any `#/…` JSON pointer, in fact — including one that indexes
an array, such as `#/$defs/timeout/anyOf/0`) before rendering, recursive
definitions are detected and collapsed so generation always terminates, and
sibling keywords on a `$ref` node — typically `description` — override the
referenced definition. Inlining is a tree expansion, so a definition reused at
several levels of nesting grows exponentially; past 100,000 inlined nodes
generation stops with an error rather than writing a README no one could read.
When a property describes its type through `enum`,
`const`, or `anyOf`/`oneOf`/`allOf` rather than a plain `type`, the **Type**
column shows an inferred label (e.g. `string` or `number | string`).

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

When there is no `README.md` yet, one is created holding just the table. When a `README.md` exists but is **missing** either marker, `generateMarkdown` throws rather than overwriting it — add both markers where the table should go and re-run.

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

### References and definitions

`$ref` pointers are inlined from `$defs` before rendering, so a schema assembled
from reusable definitions produces the same tables as an inline one. Sibling
keywords on a `$ref` (here `x-icon` and `description`) override the definition,
and a property whose type comes from `enum` (`logLevel`) gets an inferred **Type**.

<details>
<summary><strong>Input schema</strong></summary>

```json
{
  "title": "Refs",
  "required": ["server"],
  "properties": {
    "server": { "$ref": "#/$defs/server", "x-icon": "🖥️", "description": "HTTP server settings." },
    "logLevel": { "$ref": "#/$defs/logLevel", "x-icon": "🔊" }
  },
  "$defs": {
    "server": {
      "type": "object",
      "required": ["host"],
      "properties": {
        "host": { "type": "string", "x-icon": "🌐", "description": "Hostname to bind." },
        "port": { "type": "number", "x-icon": "🔌", "default": 3000, "description": "Port to listen on." }
      }
    },
    "logLevel": {
      "enum": ["debug", "info", "warn", "error"],
      "default": "info",
      "description": "Minimum log level to emit."
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
<td align="center">✅</td>
<td align="center"></td>
</tr>
<tr>
<td colspan="4">HTTP server settings.</td>
</tr>
<tr>
<td>🔊 <code>logLevel</code></td>
<td><code>string</code></td>
<td align="center"></td>
<td align="center"><code>"info"</code></td>
</tr>
<tr>
<td colspan="4">Minimum log level to emit.<br><strong>Allowed:</strong> <code>"debug"</code>, <code>"info"</code>, <code>"warn"</code>, <code>"error"</code></td>
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

## Prose reference

`generateMarkdownFiles` renders the shape a hand-written configuration guide
takes: one heading per property, a **Type:** line, the description as real
markdown, and a code example you can paste. Everything it says comes from the
schema, and it splits across as many files as the schema asks for.

```ts
import { generateMarkdownFiles } from '@amritk/generate-markdown'

const files = generateMarkdownFiles(schema, { language: 'javascript' })
// [{ filename: 'configuration.md', content: '# Configuration…' }, …]
```

<details>
<summary><strong>Input schema</strong></summary>

```json
{
  "title": "Configuration",
  "description": "Pass a universal configuration object to fine-tune your API reference.",
  "x-doc": {
    "file": "configuration.md",
    "language": "javascript",
    "layout": "none",
    "sections": [
      { "id": "properties", "title": "Properties", "sort": "alphabetical" }
    ]
  },
  "properties": {
    "darkMode": {
      "type": "boolean",
      "default": false,
      "description": "Whether dark mode is on or off initially (light mode).",
      "examples": [true],
      "x-doc": { "section": "properties" }
    },
    "documentDownloadType": {
      "enum": ["json", "yaml", "both", "none"],
      "default": "both",
      "description": "Sets the file type of the document to download.",
      "examples": ["json"],
      "x-doc": {
        "section": "properties",
        "footer": "Set it to `none` to hide the download button."
      }
    }
  }
}
```

</details>

Generated markdown:

````md
# Configuration

Pass a universal configuration object to fine-tune your API reference.

## Properties

### darkMode

**Type:** `boolean`

Whether dark mode is on or off initially (light mode).

**Default:** `false`

```javascript
{
  darkMode: true
}
```

### documentDownloadType

**Type:** `'json' | 'yaml' | 'both' | 'none'`

Sets the file type of the document to download.

**Default:** `'both'`

```javascript
{
  documentDownloadType: 'json'
}
```

Set it to `none` to hide the download button.
````

Two things there are worth pointing at. The **Type:** of an `enum` is the
literal union, because the allowed values *are* the type a reader needs — so
there is no separate "Allowed values" line repeating them. And neither property
declares a code example: both were derived from `examples`, wrapped back into
the shape of the config file. A property nested at `targets.typescript.packageName`
derives `{ targets: { typescript: { packageName: '@acme/api' } } }`, which is
something you can paste.

### The `x-doc` keyword

Everything documentation-only lives under one vendor extension, so it never
gets mistaken for something that changes validation.

On the **root schema**:

| Member | Type | What it does |
| --- | --- | --- |
| `file` | `string` | Output path of the index page. Defaults to `index.md`. Paths are normalised, so `a.md` and `./a.md` are the same page. |
| `title` | `string` | Page title, when the schema's own `title` is not the one you want. |
| `description` | `string` | Prose under the page title, when it should differ from the schema's `description`. |
| `language` | `string` | Fence language for examples, and the dialect values are written in — `json` (default) quotes keys, `javascript` does not. |
| `layout` | `'headings' \| 'table' \| 'none'` | Default layout for nested properties. Defaults to `headings`. |
| `sort` | `'schema' \| 'alphabetical'` | Default property order. Defaults to `schema`. |
| `pages` | `{ id, file, title?, description?, example? }[]` | Extra markdown files properties can be assigned to. The id `index` is reserved for the index page: declaring it configures that page (its file, title and examples) rather than adding another one. |
| `sections` | `{ id, title?, description?, page?, sort?, example? }[]` | `##` groupings inside a page. A section with no properties still renders, which is how a prose-only intro moves into the schema. |
| `example` / `examples` | see below | Code blocks under the page title. |

On a **property** (and on any `$defs` entry a property references):

| Member | Type | What it does |
| --- | --- | --- |
| `page` | `string` | Documents the property on that page instead of this one. |
| `section` | `string` | Documents it under that section. |
| `type` | `string` | Overrides the **Type:** label — for `AuthenticationConfiguration`, or `(heading: Heading) => string`, which JSON Schema cannot spell. |
| `title` | `string` | Overrides the heading text. |
| `heading` | `boolean` | `false` drops the heading and the **Type:** / **Required** markers, for the property that *is* the page or the section. Its children move up a level. The **Deprecated** callout, allowed values, examples and prose all stay — they are not restatements of the heading. |
| `layout` | `'headings' \| 'table' \| 'none'` | How this property's children are documented. |
| `sort` | `'schema' \| 'alphabetical'` | Order of this property's children. |
| `order` | `number` | Sorts ahead of properties with a higher (or no) order. |
| `hidden` | `boolean` | Keeps an internal option out of the docs entirely. |
| `description` | `string` | Prose for the docs, when it should differ from the schema's `description`. |
| `example` / `examples` | see below | Code blocks under the description. |
| `note` / `notes` | `string` or `string[]` | Blockquotes above the examples. |
| `footer` / `footers` | `string` or `string[]` | Markdown after the examples — the "and when you pass `direct`…" paragraph that only makes sense once the sample has been seen. |

An **example** is either a code string, or an object:

| Member | Type | What it does |
| --- | --- | --- |
| `code` | `string` | Literal code. |
| `value` | any JSON | Serialized into the fence's language — a JSON schema can hold a JSON example without escaping it into a string first. |
| `language` | `string` | Fence language, when it differs from the page's. |
| `caption` | `string` | A line of prose above the fence. |

### Which JSON Schema keywords it reads

| Keyword | Where it lands |
| --- | --- |
| `title`, `description` | The page title, and each property's prose (full markdown, not just the first paragraph). A property name is rendered as a code span unless it is plain enough to survive a heading; an `x-doc.title` is prose and is not, having no row to be checked against |
| `type`, `enum`, `const`, `anyOf` / `oneOf` / `allOf`, `items`, `additionalProperties` / `patternProperties` | The **Type:** label — `string[]`, `'json' \| 'yaml'`, `string \| null`, and `Record<string, T>` for a map-shaped object (one that describes its values rather than naming fields), `T` being the value shape's own label |
| `default` | **Default:**, written in the page's language |
| `examples` | The derived code example (the first one), plus **Examples:** for the rest. A tuple position past the first gets the inline list only — the positions before it are other shapes, and inventing them would produce a sample that does not validate |
| `required` | **Required** on the property it names |
| `deprecated` | A **Deprecated** callout above everything else |
| `format`, `pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems` | **Constraints:** |
| `properties`, `allOf`, `anyOf` / `oneOf`, `then` / `else`, `dependentSchemas` | The children. `allOf` branches all apply, so they contribute properties *and* requirements; alternatives and conditionals contribute properties only, and a field is required only when every alternative requires it. In the **Type:** label `allOf` reads as an intersection (`a & b`) and the alternatives as a union (`a \| b`); a branch that is itself a union is bracketed, so `(string \| number) & string` cannot be misread as the union it replaced |
| `items`, `prefixItems`, `additionalProperties`, `patternProperties` | The children of a container — an array documents its item shape (every tuple position), a map documents its value shape (every pattern) under a `<name>` key. A container whose values are another container is followed as far as it goes, so a matrix or a list of maps documents the fields at the bottom of it. A node with named properties *and* a container documents both |
| `$ref` / `$defs` / `$anchor` | Inlined before rendering — a JSON pointer (`#/$defs/x`), the empty pointer (`#`, the document itself, as a self-recursive schema writes it), or a plain-name fragment naming an `$anchor` (`#x`); a reference out of the document is not fetched. A sibling keyword at the ref site wins — except `properties` and `required`, which merge with the definition's (both applicators apply), and `x-doc`, which merges per key so a ref site can assign a page without discarding the definition's examples. A ref site's own `description` still wins over the definition's `x-doc.description` |
| A recursive `$ref` | Collapsed where it repeats, so generation terminates. The truncation is labelled with the type its definition has (a `string \| { … }` definition stays `string \| object`, an `object[]` stays `object[]`), carries that definition's documentation the way any other ref site does — its prose, its `x-doc` type, layout, examples, whether it is hidden — carries what the definition says about the value itself (`deprecated`, `default`, `examples`, and every constraint keyword), and carries what it requires, so an alternative beside it keeps its **Required** markers. Five members stay behind, because they place and announce an occurrence rather than describe it, and a truncation is an occurrence with nothing underneath: `x-doc.page`, `section`, `title`, `heading` and `order`. A reference that resolves to the document itself — `#`, `#/`, or the root's own `$anchor` — carries nothing, the root being a page configuration rather than a definition. Reading what a definition requires follows a branch's ref-site keywords as well as its definition, refuses to re-enter a definition already on the path, and is worked out once per pointer. Past 512 levels of composition it stops with an error; past 10,000 nodes it reports nothing rather than refusing the page, so a `$defs` that composes in more ways than can be enumerated costs a **Required** marker and not the document |
| root `anyOf` / `oneOf` / `allOf` | Flattened into one property list, requirements included — an `allOf` branch that only restates `required` still marks the fields it names. A property reached through alternatives is only marked required when every branch that could be an object requires it |

Each property renders in a fixed order, so a page reads as a reference rather
than a pile of keywords: heading → **Deprecated** → **Type:** → **Required** →
description → **Default:** → **Allowed values:** → **Examples:** →
**Constraints:** → notes → code examples → footers → children.

A page holds one top-level heading: its title. A schema with no `title` (and no
`x-doc.title`, and no `title` option) has no `#` — its properties still start at
`##`, because promoting them would give a twelve-option config twelve `#`
headings, which docs sites read as twelve pages. Under a `table` layout, a child
that has a shape of its own gets a heading and a table below the row, carrying
only what the row cannot: the rest of its description (the row holds the first
paragraph), a `null` default (the column skips those), its allowed values,
constraints, notes and examples, and its own children. A row is one line, so a
code block never goes in one: a description opening with a fenced or indented
sample gives the row its first paragraph of prose instead, and the sample itself
prints below the row with its indentation intact.

### Splitting across files

A property assigned to a page is documented there and nowhere else. In a table
layout its row survives on the parent's page, linked across to the file it moved
to — so a reader still sees every option in one place:

```json
{
  "x-doc": {
    "file": "configuration.md",
    "layout": "table",
    "pages": [
      { "id": "typescript", "file": "configuration/typescript.md", "title": "TypeScript" }
    ]
  },
  "properties": {
    "targets": {
      "type": "object",
      "properties": {
        "typescript": {
          "$ref": "#/$defs/typescriptTarget",
          "x-doc": { "page": "typescript", "heading": false }
        }
      }
    }
  }
}
```

That writes `configuration.md` (with a `typescript` row linking to
`configuration/typescript.md`) and `configuration/typescript.md` (titled
*TypeScript*, holding the target's options).

Placement mistakes are errors rather than silent omissions — a typo in
`x-doc.page` would otherwise drop a property out of the docs, and nothing about
the output would look wrong. Generation refuses when:

- a property names a page or a section the root never declares;
- a property's `x-doc.page` disagrees with the page its section renders on;
- two pages share an id, or resolve to the same file, or two sections share an id;
- a page is written outside the output directory, or names no file at all;
- the schema nests more than 512 levels deep, or follows composition that far,
  which no reader can follow and which is deep enough to exhaust the stack.

### Working examples

Two realistic schemas and the markdown they generate are checked in:

- [`fixtures/api-reference-config.schema.json`](./fixtures/api-reference-config.schema.json) → [one page](./fixtures/expected/api-reference-config/configuration.md)
- [`fixtures/sdk-config.schema.json`](./fixtures/sdk-config.schema.json) → [three pages](./fixtures/expected/sdk-config/)

The tests compare the generator against those files. After a deliberate change,
`bun run generate-fixtures` refreshes them — and the diff shows exactly how
every adopter's docs would change.

---

## API

### `generateMarkdown(): Promise<void>`

No arguments. Reads from `${cwd}/config.schema.json` and writes to `${cwd}/README.md`.

### `generateMarkdownFiles(schema: unknown, options?: MarkdownOptions): readonly GeneratedFile[]`

Renders the prose reference. Takes the parsed schema, returns
`{ filename, content }` pairs — no filesystem access, so a caller can diff them
in CI or write them wherever the docs live.

`options` overrides what the schema declares, for callers that want the same
schema written somewhere else: `file`, `title`, `language`, `layout`, `sort`,
`headingLevel`.

### `generateDocs(options?: GenerateDocsOptions): Promise<readonly GeneratedFile[]>`

The same thing against the filesystem: reads `schemaPath` (default
`${cwd}/config.schema.json`), writes every page under `outDir` (default `${cwd}`),
creating directories as needed, and returns what it wrote. A page whose file
would land outside `outDir` is refused rather than written.

### `renderConfigTable(schema: ConfigSchema): string`

The config table on its own, as a string. `$refs` must already be inlined —
`dereferenceSchema` does that.

### `dereferenceSchema(schema: Record<string, unknown>): unknown`

Inlines every `$ref` against the document's own `$defs`, the way both renderers
do before rendering.

---

## Related packages

- [`@amritk/mjst`](../cli) — uses this package to keep its README's flag table in sync with `config.schema.json`
- [`@amritk/generate-parsers`](../generate-parsers) — sibling generator for TypeScript parsers and types
- [`@amritk/generate-validators`](../generate-validators) — sibling generator for predicate validators

---

## License

[MIT](../../LICENSE)
