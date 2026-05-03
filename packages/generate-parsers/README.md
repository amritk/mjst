<div align="center">

# @amritk/generate-parsers

**Programmatic API for generating TypeScript parsers and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![bun](https://img.shields.io/badge/bun-required-FBF0DF?style=flat-square&logo=bun&logoColor=000000)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-84%25-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-parsers` is the core code-generation engine behind [mjst](../../README.md). Given a JSON Schema (Draft 2020-12), it produces an array of `{ filename, content }` records — TypeScript type definitions plus optional runtime parser functions that validate and coerce unknown input.

If you want a CLI, use [`@amritk/cli`](../cli). Use this package directly when you want to embed schema-to-TypeScript generation inside another build step or tool.

---

## Installation

```bash
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

### `buildSchema(rootSchema, rootTypeName, extensions?, typesOnly?)`

| Parameter | Type | Description |
|:---|:---|:---|
| `rootSchema` | `JSONSchema` | The root schema to traverse. `$ref` and `$dynamicRef` are resolved recursively. |
| `rootTypeName` | `string` | Name used for the root type (e.g. `"Document"`). |
| `extensions` | `SchemaExtensions` _(optional)_ | Map of definition name → extra optional properties to merge in before generation. |
| `typesOnly` | `boolean` _(optional)_ | When `true`, only emit `.ts` type definitions — skip parser functions and runtime helpers. |

Returns: `Promise<GeneratedFile[]>`.

The generator handles:

- `$ref` and `$dynamicRef` resolution, including JSON Schema 2020-12 `$dynamicAnchor`
- Discriminated and non-discriminated unions (`oneOf` / `anyOf`)
- Enums and `const` values
- Nested objects, arrays, records, and tuples
- Pattern-based default values

---

## Related packages

- [`@amritk/cli`](../cli) — CLI wrapping this generator
- [`@amritk/generate-validators`](../generate-validators) — predicate-style validators (sister package)
- [`@amritk/generate-markdown`](../generate-markdown) — markdown documentation generator
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
