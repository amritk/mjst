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
} as const

// Detailed errors
const validator = validate(schema)
const result = validator({ id: 1, name: 'Ada', tags: ['a', 'b'] })
if (result !== true) {
  console.error(result.errors) // [{ message, path }, ...]
}

// Fast boolean guard — the guarded type is inferred from the schema
const isUser = validateGuard(schema)

if (isUser(input)) {
  input.name // narrowed to { id: number; name: string; tags?: string[] }
}
```

### Type inference

Write the schema `as const` and the output type comes along for free — no
hand-written interface to drift from the schema. `validate` and `validateGuard`
infer it directly; `Infer` recovers it from a built validator, and `FromSchema`
derives it from a schema type:

```ts
import { validate, type FromSchema, type Infer } from '@amritk/runtime-validators'

// Straight from the schema type…
type User = FromSchema<typeof schema>
//   ^? { id: number; name: string; tags?: string[] }

// …or from a built validator.
const validateUser = validate(schema)
type SameUser = Infer<typeof validateUser>
```

Runtime-only constraints (`minLength`, `pattern`, numeric bounds, …) leave the
base type untouched, so `name` stays `string`. Inference covers every keyword that
shapes a type — `type` (incl. unions, `integer`, `nullable`), `const`, `enum`,
`properties`/`required`/`additionalProperties`/`patternProperties`,
`items`/`prefixItems` (lists and tuples), and `allOf`/`anyOf`/`oneOf`. Keywords
that cannot be expressed structurally (`$ref`, `not`, `if`/`then`/`else`,
`unevaluated*`) are skipped so the inferred type stays useful rather than
collapsing to `never`. You can still pass an explicit type argument
(`validateGuard<MyType>(schema)`) to override inference.

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

> Benchmarks live in [`bench/`](./bench) and run a correctness parity check against Ajv on every case. Correctness is further locked down by [`src/differential.test.ts`](./src/differential.test.ts), a differential fuzz that compares the interpreter's verdict against Ajv's across ~144k random and mutated values (zero divergences) — so "fast" never comes at the cost of "correct".

---

## API

### `validate(schema, options?)`

Builds an error-collecting validator that interprets the schema on the fly.

| Parameter | Type | Description |
|:---|:---|:---|
| `schema` | `unknown` | A JSON Schema (object, or a boolean schema). Local `$ref`s into the same document are resolved, including recursion. |
| `options.formats` | `'all' \| string[]` | String formats to enforce. Unlisted formats are treated as annotations (not validated), matching Ajv's opt-in behavior. |

Returns a `Validator`: `(input: unknown) => true | { valid: false; errors: ValidationError[] }`. When the schema is written `as const`, the validator carries the inferred output type — recover it with `Infer`.

### `validateGuard<T>(schema, options?)`

Builds a boolean type guard `(input: unknown) => input is T`. Same options as `validate`; it short-circuits on the first failure and allocates nothing, so it is the faster of the two when you only need yes/no. `T` is inferred from a schema written `as const`; pass it explicitly to override.

### `FromSchema<Schema>` and `Infer<Validator>`

Type-level helpers. `FromSchema<typeof schema>` infers the type a schema (written `as const`) accepts; `Infer<typeof validator>` recovers that type from a built `validate`/`validateGuard`. See [Type inference](#type-inference) above.

### Supported keywords

`type` (incl. unions and `integer`), `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `propertyNames`, `minProperties`, `maxProperties`, `dependentRequired`, `dependentSchemas`, `dependencies` (draft-07), `items`/`prefixItems` (2020-12) and array-`items` + `additionalItems` (draft-07), `contains`/`minContains`/`maxContains`, `minItems`, `maxItems`, `uniqueItems`, `unevaluatedProperties`, `unevaluatedItems`, `minLength`, `maxLength`, `pattern`, `format` (opt-in), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` (both the numeric 2020-12 form and the draft-04 boolean modifier), `multipleOf`, `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`, `$ref` (local), `nullable` (OpenAPI 3.0), boolean schemas.

> Only **local** `$ref`s are supported — the interpreter resolves both JSON-Pointer fragments (`#/$defs/user`) and `$anchor` names (`#user`) within the same document, including recursion, but does not fetch remote ones. To validate against a schema that references other documents, **bundle it first** with [`@amritk/resolve-refs`](../resolve-refs) (see [Remote and cross-file references](#remote-and-cross-file-references) below), then hand the single dereferenced document to `validate`.

> **Built-in `format`s** (opt-in via `options.formats`): `email`, `idn-email`, `date-time`, `date`, `time`, `duration`, `uuid`, `uri`, `iri`, `uri-reference`, `iri-reference`, `uri-template`, `json-pointer`, `relative-json-pointer`, `hostname`, `ipv4`, `ipv6`, `regex` (compiled, not pattern-matched). Unlisted or disabled formats are treated as annotations, matching Ajv's default opt-in behavior.

> **OpenAPI `nullable`.** When a subschema sets `nullable: true`, a `null` value is accepted regardless of its declared `type` (and short-circuits every other keyword), matching how Ajv is configured to treat OpenAPI 3.0 schemas. Without this, a single nullable field produced a flood of spurious `must be …` errors.

### Not supported (by design)

This is a **pragmatic subset** of JSON Schema — sized for validating data against the kind of schemas real APIs and configs use, not for being an authoritative, spec-complete validator. The following are intentionally left out; if your schemas lean on them, reach for Ajv:

- **Remote / non-local references.** `$ref` to another document or URL, plus `$id` base-URI resolution and `$recursiveRef`. Same-document refs — JSON-Pointer fragments, `$anchor` names, and `$dynamicRef`/`$dynamicAnchor` — resolve (including recursion); cross-document ones do not. This is a deliberate split, not a gap: fetching is async and unsafe to do from inside a validator, so it lives in [`@amritk/resolve-refs`](../resolve-refs) instead — bundle once, then validate. See [Remote and cross-file references](#remote-and-cross-file-references).
- **`contentEncoding` / `contentMediaType` / `contentSchema`** — treated as annotations (ignored), as they are by default in 2020-12.
- **Spec-exact `format` coverage.** Formats are opt-in and validated by pragmatic regexes that reject obviously-bad input rather than being RFC-perfect. (The `regex` format is the exception — it compiles the string to confirm it is a valid pattern.)
- **Draft-2020 exotica** beyond the keywords listed above.

> **Want one of these?** None of these are off the table — "by design" means *not yet*, not *never*. If something here is blocking a real use case, [open an issue](https://github.com/amritk/mjst/issues) describing the schema you need to validate.

> **`unevaluatedProperties` / `unevaluatedItems` note.** These are supported and collect annotations across the in-place applicators applied to the *same* schema object — `allOf`, `$ref`/`$dynamicRef`, the taken `if`/`then`/`else` branch, successful `anyOf`/`oneOf` branches, and `dependentSchemas`. The one case not covered is an `unevaluated*` keyword nested *inside* one applicator branch reading annotations produced by a *sibling* branch of an ancestor (e.g. `unevaluatedProperties` inside `allOf[1]` expecting to see keys evaluated by `allOf[0]`); keep `unevaluated*` at the same level as the keywords it should account for.

---

## Remote and cross-file references

The interpreter resolves only **same-document** `$ref`s, but that doesn't mean
you can't validate against schemas split across files or URLs — you just resolve
them *before* validating, not during.

This separation is deliberate. `validate` returns a **synchronous**,
zero-allocation function so it can run on the hot path and inside strict
sandboxes (CSP, Cloudflare Workers, React Native/Hermes). Fetching a remote
document is asynchronous and, when the schema is third-party, a security
concern — a `$ref` pointing at `http://169.254.169.254/…` or `file:///etc/passwd`
would turn the validator into an SSRF gadget. So the fetching lives in a
dedicated, async, I/O-aware package — [`@amritk/resolve-refs`](../resolve-refs) —
which caches documents, coalesces concurrent loads, and applies a default-deny
SSRF guard (loopback, private, link-local, and cloud-metadata hosts are refused
unless explicitly allow-listed, with the guard re-applied on every redirect hop).

Bundle once, then validate the single dereferenced document:

```typescript
import { resolveRefsFromFile } from '@amritk/resolve-refs'
import { validate } from '@amritk/runtime-validators'

// Async: fetches/reads and inlines every external $ref, SSRF-guarded.
const { resolved: schema } = await resolveRefsFromFile('./openapi.schema.json')

// Sync, pure, slim — every $ref is now local.
const isValid = validate(schema)
isValid(value)
```

The two halves compose cleanly: `resolve-refs` owns the network and its policy
(timeouts, caching, allow-lists), while `runtime-validators` stays a pure
function of `(schema, value)`.

---

## Related packages

- [`@amritk/resolve-refs`](../resolve-refs) — inline cross-file and remote `$ref`s before validating
- [`@amritk/generate-validators`](../generate-validators) — generate validator source files at build time
- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators

---

## License

[MIT](../../LICENSE)
