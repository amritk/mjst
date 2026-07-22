<div align="center">

# @amritk/generate-validators

**Programmatic API for generating predicate-style TypeScript validators from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/generate-validators?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

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
yarn add @amritk/generate-validators
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

## Semantics

Generated validators track the `@amritk/runtime-validators` interpreter. Array
items are validated in full — an item's type, `$ref`, nested `properties` /
`required`, and scalar constraints (`minLength`, `minimum`, …) are all enforced,
recursing to any depth — and the boolean guard (`isX`) reaches the identical
verdict. Validating array item *contents* costs throughput proportional to the
per-item work (a bare `string[]` is free; a closed object with several fields is
meaningfully slower), which is why array-heavy schemas validate more slowly than
scalar/object ones.

One divergence is worth calling out: **`NaN` satisfies a constrained number.**
Because the numeric bound checks are the exact negation of the error condition
(e.g. `!(x < minimum)`), and every comparison against `NaN` is `false`, a `NaN`
passes `minimum`/`maximum`/`exclusive*`/`multipleOf`. This matches the interpreter
but differs from validators (e.g. Ajv) that reject `NaN` for `type: "number"`.
`NaN` never appears in parsed JSON; guard against it upstream if your values can
be non-JSON.

---

## Benchmarks

Generated validators are straight-line, monomorphic TypeScript with no generic
dispatch. The exported `validateX` is split into a hot and a cold half: on the
happy path it runs a single allocation-free boolean guard — a pure `&&` chain of
`typeof` checks (plus an `Object.keys().length` count when an object is closed
with `additionalProperties: false`) — and `return true`s straight away, only
calling a separate error-collecting function when something is actually wrong.
Keeping the hot function tiny lets V8 optimise it aggressively, so a valid-input
check beats every other library measured — including the build-time transformer
typia — while still emitting full JSON-Pointer errors for invalid input, and
emitting the validator stays far cheaper than compiling a schema at startup.
Measured on Bun 1.3 (Linux x64), validating valid input at steady state:

| schema | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|--:|
| small (4 fields) | **~48M** ops/s | ~5M ops/s | ~10.5M ops/s | ~5.3M ops/s | ~2M ops/s |
| order (nested + array) | **~7.8M** ops/s | ~2.2M ops/s | ~3.5M ops/s | ~2.1M ops/s | ~0.5M ops/s |
| assert-loose | **~184M** ops/s | ~183M ops/s | ~45M ops/s | ~63M ops/s | ~3.8M ops/s |
| assert-strict | **~162M** ops/s | ~148M ops/s | ~22M ops/s | ~38M ops/s | ~1.3M ops/s |

The `assert-loose` / `assert-strict` rows are the exact shape used by
[`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks)
(seven scalar roots plus a nested object): the boolean guard puts mjst clearly
ahead of typia on `assert-strict` (with `additionalProperties: false`) and
neck-and-neck with it on `assert-loose` — the two trade the lead run-to-run
within noise. (typia and TypeBox still win the *invalid* path, where they bail on
the first error rather than collecting a full error list.)

Preparing a validator costs ~0.3–0.6 ms for mjst codegen and ~0.05–0.2 ms for a
TypeBox `TypeCompiler` compile, versus ~9–12 ms for an Ajv compile. Every library
agrees on every verdict; parity is asserted before timing (TypeBox is given
uuid/email format checkers so every library does the same work). Each library is
timed in an isolated process over a pool of distinct inputs, reporting the median
of many trials — so the optimiser can't hoist or eliminate the work and the
numbers stay reproducible. Micro-benchmark figures vary by machine and runtime —
reproduce with:

```bash
bun run bench
```

---

## Related packages

- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
