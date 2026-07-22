<div align="center">

# @amritk/generate-parsers

**Programmatic API for generating TypeScript parsers and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/generate-parsers?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-parsers` is the core code-generation engine behind [mjst](../../README.md). Given a JSON Schema (Draft 2020-12), it produces an array of `{ filename, content }` records — TypeScript type definitions plus optional runtime parser functions that validate and coerce unknown input.

If you want a CLI, use [`@amritk/mjst`](../cli). Use this package directly when you want to embed schema-to-TypeScript generation inside another build step or tool.

---

## Installation

```bash
npm install @amritk/generate-parsers
# or
pnpm add @amritk/generate-parsers
# or
yarn add @amritk/generate-parsers
# or
bun add @amritk/generate-parsers
```

---

## Usage

```ts
import { buildSchema } from '@amritk/generate-parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const schema: JSONSchema = {
  type: 'object',
  properties: {
    info: { $ref: '#/$defs/info' },
  },
  $defs: {
    info: {
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}

const files = await buildSchema(schema, 'Document')
// → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', content: '...' }, ...]
```

Each entry in `files` is a `GeneratedFile`:

```ts
type GeneratedFile = {
  filename: string
  content: string
}
```

Write them to disk however you like.

---

## API

### `buildSchema(rootSchema, rootTypeName, extensions?, typesOnly?, logWarnings?, strict?)`

| Parameter | Type | Description |
|:---|:---|:---|
| `rootSchema` | `JSONSchema` | The root schema to traverse. `$ref` and `$dynamicRef` are resolved recursively. |
| `rootTypeName` | `string` | Name used for the root type (e.g. `"Document"`). |
| `extensions` | `SchemaExtensions` _(optional)_ | Map of definition name → extra optional properties to merge in before generation. |
| `typesOnly` | `boolean` _(optional)_ | When `true`, only emit `.ts` type definitions — skip parser functions and runtime helpers. |
| `logWarnings` | `boolean` _(optional)_ | When `true`, generated parsers emit a `console.warn` for every input key not declared in the schema's properties. |
| `strict` | `boolean` _(optional)_ | When `true`, generated parsers throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. |

Returns: `Promise<GeneratedFile[]>`.

---

## Options

<!-- config-table-start -->
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
<td>🏷️ <code>typesOnly</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Generate only TypeScript type definitions without parser functions. Runtime helper files (validators, isObject) are also omitted since they are only needed for parsers.</td>
</tr>
<tr>
<td>⚠️ <code>logWarnings</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Emit a console.warn in the generated parsers for every input key that is not declared in the schema's properties. Useful for detecting schema drift or unexpected data shapes at runtime.</td>
</tr>
<tr>
<td>🚫 <code>strict</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Generate parsers that throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. When a schema sets additionalProperties: false, undeclared keys throw too; otherwise they are still allowed.</td>
</tr>
<tr>
<td>🧹 <code>stripUnknown</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Build each parser's result from the schema's declared properties only, silently dropping undeclared input keys at every nesting level (zod's .strip()). Extras are never a validation error, so this composes with strict (which still throws on wrong types and missing required properties) and yields to additionalProperties: false, which rejects rather than strips in strict mode.</td>
</tr>
<tr>
<td>🔡 <code>caseInsensitive</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Normalize a mis-cased string to the exact casing of a declared enum/const member it matches case-insensitively (e.g. hElLo → hello) instead of coercing to the default. Coerce mode only — strict parsers still reject a casing mismatch. Correctly-cased input keeps the exact-match fast path, so the hot path is unaffected.</td>
</tr>
</tbody>
</table>
<!-- config-table-end -->

The generator handles:

- `$ref` and `$dynamicRef` resolution, including JSON Schema 2020-12 `$dynamicAnchor`
- Discriminated and non-discriminated unions (`oneOf` / `anyOf`)
- Enums and `const` values
- Nested objects, arrays, records, and tuples
- Pattern-based default values

---

## Benchmarks

Generated parsers are plain, straight-line TypeScript — no schema walking and no
generic dispatch at runtime, because the schema was already spent at build time.
Each parser reads the exact keys it declares, coerces or asserts them inline, and
returns a fresh typed object, so on valid input it runs several times faster than
libraries that interpret a schema (or a schema-shaped object graph) on every
call. The `bench/` suite replicates the `parseSafe` (assert + strip undeclared
keys) and `parseStrict` (assert + reject undeclared keys) halves of
[`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks)
against the other *pure* parsers — the ones that return a new typed value rather
than mutating in place — [zod](https://zod.dev) and
[TypeBox](https://github.com/sinclairzx81/typebox). Measured on Bun 1.3 (Linux
x64), parsing valid input at steady state:

| case | mode | mjst (generated) | zod | typebox |
|:--|:--|--:|--:|--:|
| user (4 fields) | parseSafe | **~16M** ops/s | ~3.3M ops/s | ~1.3M ops/s |
| order (nested + array) | parseSafe | **~5.8M** ops/s | ~0.6M ops/s | ~0.18M ops/s |
| user (4 fields) | parseStrict | **~13M** ops/s | ~1.8M ops/s | ~1.85M ops/s |
| order (nested + array) | parseStrict | **~7.5M** ops/s | ~0.36M ops/s | ~0.28M ops/s |

The upstream `assert` case (seven scalar roots plus a nested object) runs faster
still — tens of millions of ops/s — but at that size the numbers swing enough
run-to-run that the ratio, not the absolute, is the honest signal: mjst lands
~5–30× ahead of zod across every case above.

The trade is a one-shot **prepare** cost that only mjst pays — generating the
parser source — which measures **~0.1–0.8 ms** per schema here (zod and TypeBox
author or interpret their parsers with no separate build step, so there is
nothing to time). That is trivially amortized: you generate once at build time
and run the emitted code forever.

Every library is checked for agreement — same stripped/rejected output, same
throws on bad input — before it is timed, and each is timed in its own isolated
process over a pool of distinct inputs, reporting the median of many trials, so
the optimiser can't hoist the work away. Micro-benchmark figures vary by machine
and runtime — reproduce with:

```bash
bun run bench
```

---

## Related packages

- [`@amritk/mjst`](../cli) — CLI wrapping this generator
- [`@amritk/generate-validators`](../generate-validators) — predicate-style validators (sister package)
- [`@amritk/generate-markdown`](../generate-markdown) — markdown documentation generator
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
