<div align="center">

# @amritk/helpers

**Shared schema-traversal and runtime helpers for the mjst code generation ecosystem.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/helpers` is the shared utility belt used by [mjst](../../README.md)'s generators **and** by the runtime code those generators produce. Each helper is published as its own subpath export so consumers (and generated output) only pull in what they need — no barrel, no incidental dependencies.

---

## Installation

```bash
npm install @amritk/helpers
# or
pnpm add @amritk/helpers
# or
yarn add @amritk/helpers
# or
bun add @amritk/helpers
```

---

## Modules

### Schema traversal

| Subpath | Exports | Purpose |
|:---|:---|:---|
| `@amritk/helpers/extract-refs` | `extractRefs` | Collect every `$ref` reachable from a schema. |
| `@amritk/helpers/resolve-ref` | `resolveRef` | Resolve a JSON pointer `$ref` against a root schema. |
| `@amritk/helpers/build-dynamic-ref-map` | `buildDynamicRefMap` | Build a map of `$dynamicAnchor` → resolved location. |
| `@amritk/helpers/resolve-dynamic-refs` | `resolveDynamicRefs` | Replace `$dynamicRef` occurrences using the map above. |
| `@amritk/helpers/upgrade-draft07-schema` | `upgradeDraft07Schema`, `isDraft07Schema` | Upgrade a Draft-07 schema to 2020-12. |
| `@amritk/helpers/ref-to-filename` | `refToFilename`, `toKebabCase` | Convert a `$ref` to a stable filename. |
| `@amritk/helpers/ref-to-name` | `refToName` | Convert a `$ref` to a TypeScript identifier (PascalCase). |
| `@amritk/helpers/schema-guards` | `isSchemaObject`, `hasType`, `hasProperties`, `hasOneOf`, `hasAnyOf`, `hasAllOf`, `hasEnum`, `hasConst`, `hasPattern`, `hasFormat`, `hasDefault`, `hasExamples`, `hasRequired`, `hasItems`, `hasAdditionalProperties`, `hasMinLength`, `hasMaxLength`, `hasMinimum`, `hasMaximum`, `hasExclusiveMinimum`, `hasExclusiveMaximum`, `hasMultipleOf`, `hasMinItems`, `hasMaxItems`, `hasUniqueItems`, `hasMinProperties`, `hasMaxProperties`, … | Type-narrowing predicates for JSON Schema keywords. |

### Codegen utilities

| Subpath | Exports | Purpose |
|:---|:---|:---|
| `@amritk/helpers/generate-type-definition` | `generateTypeDefinition` | Render a TypeScript type from a schema node. |
| `@amritk/helpers/parse-documentation` | `parseDocumentation`, `ObjectDocumentation` | Parse a markdown doc file into per-property descriptions. |

### Runtime helpers (also copied into generated output)

| Subpath | Exports | Purpose |
|:---|:---|:---|
| `@amritk/helpers/is-object` | `isObject` | Narrow `unknown` → `Record<string, unknown>`. |
| `@amritk/helpers/safe-accessor` | `safeAccessor` | Read a key from an unknown value without throwing. |
| `@amritk/helpers/validate-array` | `validateArray` | Validate array shape and items. |
| `@amritk/helpers/validate-record` | `validateRecord` | Validate record shape and additional properties. |

---

## Usage

```ts
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { isObjectSchema, hasProperties } from '@amritk/helpers/schema-guards'

const node = resolveRef('#/$defs/info', rootSchema)

if (isObjectSchema(node) && hasProperties(node)) {
  for (const [name, property] of Object.entries(node.properties)) {
    // ...
  }
}
```

Each helper has its own colocated test file (`*.test.ts`) — read those for canonical examples.

---

## Related packages

- [`@amritk/generate-parsers`](../generate-parsers) — primary consumer
- [`@amritk/generate-validators`](../generate-validators) — primary consumer
- [`@amritk/mjst`](../cli) — the CLI surface

---

## License

[MIT](../../LICENSE)
