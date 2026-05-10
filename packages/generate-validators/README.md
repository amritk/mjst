<div align="center">

# @amritk/generate-validators

**Programmatic API for generating predicate-style TypeScript validators from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-100%25-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-validators` produces lightweight runtime **validators** from a JSON Schema. Where [`@amritk/generate-parsers`](../generate-parsers) coerces and parses unknown input into a typed value, this package emits cheaper predicate-style functions that simply tell you whether a value matches a schema (and where it doesn't).

Each generated file exports:

- A TypeScript `type` definition for the schema
- A `validateFoo(input: unknown, _path?: string): ValidationResult` function

A shared `validation-result.ts` template and an `index.ts` barrel are emitted alongside the generated files.

---

## Installation

```bash
npm install @amritk/generate-validators
# or
pnpm add @amritk/generate-validators
# or
bun add @amritk/generate-validators
```

---

## Usage

```ts
import { buildValidatorSchema } from '@amritk/generate-validators'
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
      required: ['title'],
    },
  },
}

const files = await buildValidatorSchema(schema, 'Document')
// → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', ... }, { filename: 'validation-result.ts', ... }, { filename: 'index.ts', ... }]
```

Write the resulting files to disk and import the validators where you need them:

```ts
import { validateDocument } from './generated'

const result = validateDocument(input)
if (!result.valid) {
  console.error(result.errors)
}
```

---

## API

### `buildValidatorSchema(rootSchema, rootTypeName)`

| Parameter | Type | Description |
|:---|:---|:---|
| `rootSchema` | `JSONSchema` | The root schema to traverse. `$ref` and `$dynamicRef` are resolved recursively. Draft-07 schemas are upgraded to 2020-12 automatically. |
| `rootTypeName` | `string` | Name used for the root type (e.g. `"Document"`). |

Returns: `Promise<GeneratedFile[]>` where `GeneratedFile = { filename: string; content: string }`.

---

## Related packages

- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
