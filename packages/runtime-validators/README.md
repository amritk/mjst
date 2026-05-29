<div align="center">

# @amritk/runtime-validators

**Extremely fast runtime JSON Schema validation — for schemas you do not know ahead of time.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-100%25-a855f7?style=flat-square)

</div>

---

## Overview

[`@amritk/generate-validators`](../generate-validators) writes validator **source files** at build time from a schema you already have. This package is its runtime sibling: it compiles a schema **you only discover at runtime** — a plugin config, a user-supplied schema, an OpenAPI fragment — into a specialized validator function.

Like the rest of `mjst`, the obsession here is performance. A schema is compiled, once, into a single flat JavaScript function via `new Function`. Everything that cannot be a source literal (regexes, enum lookup sets, deep-equal constants) is hoisted into the function's closure so it is built once and never recompiled. There are no per-keyword dispatch calls, no walking the schema at validation time, and — on the happy path — no allocations.

Two entry points, for two different jobs:

- **`validateGuard(schema)`** → `(input) => input is T`. The fastest path: a boolean type guard that short-circuits on the first failure and never allocates. Reach for this in hot loops, request filters, and cache gates.
- **`validate(schema)`** → `(input) => true | { valid: false, errors }`. Collects every error with a JSON Pointer path, so you can tell a caller exactly what went wrong.

---

## Installation

```bash
npm install @amritk/runtime-validators
# or
pnpm add @amritk/runtime-validators
# or
yarn add @amritk/runtime-validators
# or
bun add @amritk/runtime-validators
```

---

## Usage

```ts
import { validate, validateGuard } from '@amritk/runtime-validators'

const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
  required: ['id', 'name'],
  additionalProperties: false,
}

// Detailed errors
const validator = validate(schema)
const result = validator({ id: 1, name: 'Ada', tags: ['a', 'b'] })
if (result !== true) {
  console.error(result.errors) // [{ message, path }, ...]
}

// Fast boolean guard (with type narrowing)
type User = { id: number; name: string; tags?: string[] }
const isUser = validateGuard<User>(schema)

if (isUser(input)) {
  input.name // narrowed to User
}
```

Recursive schemas via local `$ref` work out of the box:

```ts
const isTree = validateGuard({
  type: 'object',
  properties: {
    value: { type: 'number' },
    children: { type: 'array', items: { $ref: '#' } },
  },
  required: ['value'],
})
```

---

## Performance

Two things matter for a runtime validator: how fast it **validates**, and how cheap it is to **compile** (startup). This package is built to win both, especially on large schemas.

Representative numbers from `bun run bench` (a wide 40-property object and a deep `$ref` + arrays document; your hardware will differ — run it yourself):

| schema | validator | valid throughput | vs Ajv | invalid throughput | vs Ajv |
|:---|:---|---:|---:|---:|---:|
| wide (40 props) | `validateGuard` | 2.6M ops/s | **1.8×** | 67M ops/s | **17×** |
| wide (40 props) | `validate` | 2.5M ops/s | **1.7×** | 2.3M ops/s | 1.7× vs all-errors |
| deep (`$ref`) | `validateGuard` | 0.61M ops/s | **1.7×** | 29M ops/s | **3.3×** |
| deep (`$ref`) | `validate` | 0.56M ops/s | **1.5×** | 2.6M ops/s | 2.9× vs all-errors |

The boolean guard short-circuits, so invalid input is where it pulls away the hardest. `validate` collects all errors, so the fair comparison there is Ajv with `allErrors: true`.

**Startup cost** is where the gap is widest. Because the compiler is lean and does no schema-of-schema validation, compiling a single schema is **dozens to hundreds of times cheaper** than Ajv:

| schema | `validate` | Ajv | speedup |
|:---|---:|---:|---:|
| small | ~0.03 ms | ~10 ms | **~350×** |
| wide (40 props) | ~0.19 ms | ~15 ms | **~75×** |
| deep (`$ref`) | ~0.18 ms | ~13 ms | **~65×** |

Startup is kept cheap from several directions:

- **Lazy compilation.** `validate` / `validateGuard` return immediately; the `new Function` JIT is deferred until the validator is first actually called. An app that builds many validators at boot (a schema registry, a router) only pays for the ones it uses — constructing an unused validator is ~1–6 µs.
- **A `WeakMap` cache.** Repeated `validate(sameSchema)` calls return the same validator, so a given schema is compiled at most once per `(mode, formats)`.
- **A lean compiler.** No schema-of-schema validation, no `$ref` graph bookkeeping — just a single recursive pass that emits source.

> Benchmarks live in [`bench/`](./bench). They include a correctness parity check against Ajv on every case, and the suite is backed by a differential fuzz test (150k+ random and mutated values, zero divergences) so "fast" never comes at the cost of "correct".

---

## API

### `validate(schema, options?)`

Compiles a schema into an error-collecting validator.

| Parameter | Type | Description |
|:---|:---|:---|
| `schema` | `unknown` | A JSON Schema (object, or a boolean schema). Local `$ref`s into the same document are resolved, including recursion. |
| `options.formats` | `'all' \| string[]` | String formats to enforce. Unlisted formats are treated as annotations (not validated), matching Ajv's opt-in behavior. |

Returns a `Validator`: `(input: unknown) => true | { valid: false; errors: ValidationError[] }`.

### `validateGuard<T>(schema, options?)`

Compiles a schema into a boolean type guard `(input: unknown) => input is T`. Same options as `validate`. This is the fastest option and allocates nothing.

### Supported keywords

`type` (incl. unions and `integer`), `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `minProperties`, `maxProperties`, `dependentRequired`, `items`/`prefixItems` (2020-12) and array-`items` + `additionalItems` (draft-07), `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `format` (opt-in), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`, `$ref` (local), `nullable` (OpenAPI 3.0), boolean schemas.

> Only **local** `$ref`s are supported — a compiled validator is a single self-contained function, so it does not fetch remote documents. Bundle external schemas into `$defs` first.

> **OpenAPI `nullable`.** When a subschema sets `nullable: true`, a `null` value is accepted regardless of its declared `type` (and short-circuits every other keyword), matching how Ajv is configured to treat OpenAPI 3.0 schemas. Without this, a single nullable field produced a flood of spurious `must be …` errors.

---

## Related packages

- [`@amritk/generate-validators`](../generate-validators) — generate validator source files at build time
- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators

---

## License

[MIT](../../LICENSE)
