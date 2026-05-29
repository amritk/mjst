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

[`@amritk/generate-validators`](../generate-validators) writes validator **source files** at build time from a schema you already have. This package is its runtime sibling: it validates against a schema **you only discover at runtime** — a plugin config, a user-supplied schema, an OpenAPI fragment.

It is an **eval-free interpreter**: it walks the schema directly, with **no `new Function`, no code generation, and no build step**. That buys two things. First, **zero startup cost** — there is nothing to compile, so building a validator is essentially free and you only pay to walk the data you actually validate. Second, it **runs anywhere** — under a strict `Content-Security-Policy` (no `unsafe-eval`), on Cloudflare Workers, in React Native/Hermes, and in any sandbox that forbids `eval`/`new Function`, all of which rule out a code-generating validator.

The trade is steady-state throughput: a JIT-compiled validator (like Ajv after it compiles) validates a *single fixed schema* against *millions of values* faster than an interpreter can. So this package is tuned for the opposite shape — **validate a few values per schema, in a cold process** (CLI checks, one-shot config validation, edge requests), where there is no compile cost to amortize. See [Performance](#performance).

Two entry points, for two different jobs:

- **`validateGuard(schema)`** → `(input) => input is T`. A boolean type guard that short-circuits on the first failure and never allocates. Reach for this when you only need yes/no.
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

Pick the right tool for the shape of your workload. There are two regimes, and they have opposite winners.

**Cold one-shot — schema to first result.** This is the path this package is built for: you have a schema and a value or two, in a fresh process, and you want an answer. There is no compile step, so the cost is essentially one walk of the data. Ajv must compile the schema (build and JIT a function) before it can validate even once. Representative numbers from `bun run bench` (your hardware will differ — run it yourself):

| schema | `validate` (cold) | Ajv (compile + run) | speedup |
|:---|---:|---:|---:|
| small | ~0.005 ms | ~8 ms | **~1600×** |
| wide (40 props) | ~0.016 ms | ~11 ms | **~700×** |
| deep (`$ref`) | ~0.12 ms | ~11 ms | **~90×** |

**Steady state — one schema, many values.** Here Ajv wins, and it is not close: once compiled, its JIT'd function outruns a tree-walking interpreter by roughly **15–25×** per call. If you validate the same schema against a high-throughput stream, compile it once with Ajv (or use this repo's build-time [`@amritk/generate-validators`](../generate-validators)) — an interpreter is the wrong tool for that job, and this package does not pretend otherwise.

So the rule of thumb: **few values per schema → interpret** (no compile cost to amortize, and it runs eval-free anywhere); **many values per schema → compile**.

What keeps the interpreter lean:

- **No compile step.** `validate` / `validateGuard` return immediately — there is nothing to build, JIT, or warm up.
- **Lazy, reused caches.** The only reusable work — compiling `pattern` regexes and resolving `$ref` targets — is memoized the first time it is hit and reused on later calls.
- **No allocation on the happy path.** The error array is created only when the first error is recorded, so valid input (and the entire guard path) allocates nothing.
- **A `WeakMap` cache** keyed by schema object, so `validate(sameSchema)` hands back the same validator (with its warm caches) per `(mode, formats)`.

> Benchmarks live in [`bench/`](./bench) and run a correctness parity check against Ajv on every case. Correctness is further locked down by [`src/differential.test.ts`](./src/differential.test.ts), a differential fuzz that compares the interpreter's verdict against Ajv's across ~72k random and mutated values (zero divergences) — so "fast" never comes at the cost of "correct".

---

## API

### `validate(schema, options?)`

Builds an error-collecting validator that interprets the schema on the fly.

| Parameter | Type | Description |
|:---|:---|:---|
| `schema` | `unknown` | A JSON Schema (object, or a boolean schema). Local `$ref`s into the same document are resolved, including recursion. |
| `options.formats` | `'all' \| string[]` | String formats to enforce. Unlisted formats are treated as annotations (not validated), matching Ajv's opt-in behavior. |

Returns a `Validator`: `(input: unknown) => true | { valid: false; errors: ValidationError[] }`.

### `validateGuard<T>(schema, options?)`

Builds a boolean type guard `(input: unknown) => input is T`. Same options as `validate`; it short-circuits on the first failure and allocates nothing, so it is the faster of the two when you only need yes/no.

### Supported keywords

`type` (incl. unions and `integer`), `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `minProperties`, `maxProperties`, `dependentRequired`, `items`/`prefixItems` (2020-12) and array-`items` + `additionalItems` (draft-07), `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `format` (opt-in), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`, `$ref` (local), `nullable` (OpenAPI 3.0), boolean schemas.

> Only **local** `$ref`s are supported — the interpreter resolves pointers within the same document and does not fetch remote ones. Bundle external schemas into `$defs` first.

> **OpenAPI `nullable`.** When a subschema sets `nullable: true`, a `null` value is accepted regardless of its declared `type` (and short-circuits every other keyword), matching how Ajv is configured to treat OpenAPI 3.0 schemas. Without this, a single nullable field produced a flood of spurious `must be …` errors.

---

## Related packages

- [`@amritk/generate-validators`](../generate-validators) — generate validator source files at build time
- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators

---

## License

[MIT](../../LICENSE)
