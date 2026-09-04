<div align="center">

# @amritk/helpers

**Shared schema-traversal and runtime helpers for the mjst code generation ecosystem.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/helpers?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
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
| `@amritk/helpers/resolve-ref` | `resolveRef` | Resolve a `$ref` — JSON Pointer, `$anchor` name, or URI — against a root schema. |
| `@amritk/helpers/build-anchor-map` | `buildAnchorMap` | Build a map of `$anchor` / `$dynamicAnchor` name → JSON Pointer. |
| `@amritk/helpers/build-dynamic-ref-map` | `buildDynamicRefMap` | Build a map of `$dynamicAnchor` → resolved location. |
| `@amritk/helpers/resolve-dynamic-refs` | `resolveDynamicRefs` | Replace `$dynamicRef` occurrences using the map above. |
| `@amritk/helpers/assert-id-scopes` | `assertIdScopes` | Reject a document whose `$id`-scoped fragment ref resolves to nothing in its own resource. |
| `@amritk/helpers/max-schema-depth` | `MAX_SCHEMA_DEPTH`, `assertSchemaDepth` | The nesting cap every recursive walker enforces. |
| `@amritk/helpers/upgrade-draft07-schema` | `upgradeDraft07Schema`, `isDraft07Schema` | Upgrade a Draft-07 schema to 2020-12. |
| `@amritk/helpers/ref-to-filename` | `refToFilename`, `toKebabCase` | Convert a `$ref` to a stable filename. |
| `@amritk/helpers/ref-to-name` | `refToName` | Convert a `$ref` to a TypeScript identifier (PascalCase). |
| `@amritk/helpers/walk-ref-graph` | `walkRefGraph`, `RefNode` | The shared `$ref`-graph traversal every generator runs: upgrades draft-07, resolves each ref, rewrites `$dynamicRef`, derives type/file names, and hands one pre-computed node per output file to a `visit` callback. |
| `@amritk/helpers/build-resource-registry` | `buildResourceRegistry`, `ResourceRegistry` | Read a document's `$id` base-URI scopes once, expressed as JSON Pointers. |
| `@amritk/helpers/normalize-ref-scopes` | `normalizeRefScopes` | Rewrite every `$ref` / `$dynamicRef` to a plain root-relative JSON Pointer, applying the `$id` bases in scope. |
| `@amritk/helpers/resolve-scoped-ref` | `resolveScopedRef`, `ScopedRefTarget` | Where a `$ref` lands once the `$id` bases in scope are applied. |
| `@amritk/helpers/graft-external-schemas` | `graftExternalSchemas`, `GraftedSchema` | Fold already-loaded external documents into the document being generated so cross-document refs resolve like local ones. |
| `@amritk/helpers/prune-external-schemas` | `pruneExternalSchemas` | Drop the grafted documents nothing references. |
| `@amritk/helpers/extract-dynamic-anchor-defs` | `extractDynamicAnchorDefs` | Collect a `#/...` ref for every subschema carrying a `$dynamicAnchor`. |
| `@amritk/helpers/fold-nullable` | `foldNullable` | Rewrite OpenAPI 3.0 `nullable: true` into a `null` member of `type`. |
| `@amritk/helpers/derive-root-type-name` | `deriveRootTypeName` | Turn a schema `title` into a PascalCase root type name. |
| `@amritk/helpers/read-key` | `readKey`, `declaresKey` | Read an author-chosen name (`$defs` entry, config key) off a map, treating inherited names such as `__proto__` as absent. |
| `@amritk/helpers/assign-key` | `assignKey` | Assign a key on a rebuilt object without letting `__proto__` reach the prototype setter. |
| `@amritk/helpers/schema-guards` | `isSchemaObject`, `hasType`, `hasProperties`, `hasOneOf`, `hasAnyOf`, `hasAllOf`, `hasEnum`, `hasConst`, `hasPattern`, `hasFormat`, `hasDefault`, `hasExamples`, `hasRequired`, `hasItems`, `hasAdditionalProperties`, `hasMinLength`, `hasMaxLength`, `hasMinimum`, `hasMaximum`, `hasExclusiveMinimum`, `hasExclusiveMaximum`, `hasMultipleOf`, `hasMinItems`, `hasMaxItems`, `hasUniqueItems`, `hasMinProperties`, `hasMaxProperties`, … | Type-narrowing predicates for JSON Schema keywords. |

### Codegen utilities

| Subpath | Exports | Purpose |
|:---|:---|:---|
| `@amritk/helpers/generate-type-definition` | `generateTypeDefinition` | Render a TypeScript type from a schema node. |
| `@amritk/helpers/mjst-extension` | `MJST_EXTENSION_KEY`, `getMjstInstanceOf`, `getMjstPrimitive`, `getMjstBrand` | Read the `x-mjst` vendor hints (`instanceOf`, `primitive`, `brand`) a schema carries. |
| `@amritk/helpers/generate-index-barrel` | `generateIndexBarrel` | Render the `index.ts` barrel that re-exports every generated file. |
| `@amritk/helpers/escape-regex-pattern` | `escapeRegexPattern`, `regexFlagsFor`, `regexLiteral` | Embed a JSON Schema `pattern` in a generated regex literal, validating it at generation time. |
| `@amritk/helpers/quote-js-string` | `quoteJsString` | Quote a string as a JS literal, escaping only when needed. |
| `@amritk/helpers/multiple-of-check` | `multipleOfPassExpr`, `multipleOfFailExpr` | Emit a `multipleOf` check that agrees with the runtime interpreter. |
| `@amritk/helpers/numeric-bound-check` | `boundPassExpr`, `boundFailExpr`, `boundOperator` | Emit `minimum` / `maximum` / `exclusive*` checks that agree with the runtime interpreter. |
| `@amritk/helpers/string-length-check` | `minLengthPassExpr`, `maxLengthPassExpr`, … | Emit `minLength` / `maxLength` checks that count code points, not UTF-16 units. |
| `@amritk/helpers/unknown-key-check` | `unknownKeyCheck`, `INLINE_KEY_LIMIT` | Emit an unknown-key sweep — inline comparisons for small key sets, a hoisted `Set` past the limit. |
| `@amritk/helpers/parse-documentation` | `parseDocumentation`, `ObjectDocumentation` | Parse one section of the OpenAPI specification markdown (selected by a `commentUrl` fragment such as `#info-object`) into a title, description, and per-property descriptions. |
| `@amritk/helpers/safe-accessor` | `safeAccessor`, `hasOwnCheck`, `missingCheck`, `safeKey` | Emit a safe JS property-access expression (dot vs bracket notation, own-property guard for `Object.prototype` names). |

### Runtime helpers (also copied into generated output)

| Subpath | Exports | Purpose |
|:---|:---|:---|
| `@amritk/helpers/is-object` | `isObject` | Narrow `unknown` → `Record<string, unknown>`. |
| `@amritk/helpers/has-ref` | `hasRef` | Narrow a value to an object carrying a string `$ref`. |
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

Most helpers have a colocated test file (`*.test.ts`) — read those for canonical examples.

---

## Related packages

- [`@amritk/generate-parsers`](../generate-parsers) — primary consumer
- [`@amritk/generate-validators`](../generate-validators) — primary consumer
- [`@amritk/mjst`](../cli) — the CLI surface

---

## License

[MIT](../../LICENSE)
