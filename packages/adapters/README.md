<div align="center">

# @amritk/adapters

**Convert schemas authored in TypeBox, Zod, Valibot, or Effect into Draft 2020-12 JSON Schema — the single input shape the mjst generators understand.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.2.16-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

mjst's generators — parsers, validators, types, docs, test data — all take **one** input: a Draft 2020-12 JSON Schema. This package lets you author that schema in a validation library you already use instead. It converts a **TypeBox**, **Zod**, **Valibot**, or **Effect** schema into JSON Schema, then hands the result straight to the generators.

The [`mjst`](../cli) CLI wires these in behind the `--input <format>` flag (`typebox`, `zod`, `valibot`, `effect`); with any of those the `--schema` path points at a JS/TS **module** that exports a schema rather than a `.json` file. You can also call the adapters directly — each is a small, pure async function.

Each adapter leans on its source library's own JSON Schema exporter (Zod 4's `toJSONSchema`, `@valibot/to-json-schema`, Effect's `JSONSchema.make`; TypeBox schemas are already JSON Schema at runtime) and then normalises the result:

- strips the dialect marker (`$schema`) the generators don't need,
- rewrites constructs JSON Schema can't express — runtime `Date`, `bigint` — into the shared [`x-mjst`](#the-x-mjst-extension) hint the generators read, and
- **warns and continues** on anything genuinely unrepresentable rather than throwing, so one unsupported field never blocks generation.

---

## Installation

```bash
npm install --save-dev @amritk/adapters
# or: pnpm add -D / yarn add -D / bun add -d
```

### Peer dependencies

The source libraries are **optional peer dependencies** — each adapter dynamically imports its library at runtime, so you install only the one(s) you actually use. TypeBox needs no peer dependency at all (its schemas are plain JSON Schema objects; the adapter never imports TypeBox).

| Input format | Install |
|:---|:---|
| `typebox` | *(nothing — see below)* |
| `zod` | `zod@>=4` |
| `valibot` | `valibot@>=1` **and** `@valibot/to-json-schema@>=1` |
| `effect` | `effect@>=3` |

If the required package is missing (or too old), the adapter throws a clear, actionable error naming what to install — e.g. *"The Zod adapter requires 'zod' (v4 or later) to be installed in your project."*

> [!NOTE]
> The TypeBox adapter deliberately does **not** import TypeBox. It works purely on the plain-object shape of the schema (via a JSON round-trip), so TypeBox stays a dependency of your schema module alone, never of mjst.

---

## Usage

Each adapter is a function `(source: unknown) => Promise<JSONSchema>` (TypeBox's is synchronous but is exposed with the same signature for uniformity). Import them by subpath:

```ts
import { typeboxToJsonSchema } from '@amritk/adapters/typebox-to-json-schema'
import { zodToJsonSchema } from '@amritk/adapters/zod-to-json-schema'
import { valibotToJsonSchema } from '@amritk/adapters/valibot-to-json-schema'
import { effectToJsonSchema } from '@amritk/adapters/effect-to-json-schema'
```

Or resolve one by name — matching the CLI's `--input` flag:

```ts
import { getAdapter } from '@amritk/adapters/get-adapter'

const adapter = getAdapter('zod') // throws for an unimplemented / unknown format
const jsonSchema = await adapter.toJSONSchema(mySchema)
```

Adapters receive the **already-loaded** schema value (an imported module export), not a file path — loading the module is the caller's job, which keeps the adapters pure and trivial to test.

### TypeBox

```ts
import { Type } from '@sinclair/typebox'
import { typeboxToJsonSchema } from '@amritk/adapters/typebox-to-json-schema'

const User = Type.Object({
  id: Type.Integer(),
  name: Type.String({ minLength: 1 }),
  createdAt: Type.Date(),
})

const jsonSchema = await typeboxToJsonSchema(User)
```

A TypeBox schema is already a JSON Schema object at runtime — it just carries non-enumerable symbol keys (`Kind`, `Optional`, …) for TypeBox's own machinery. A JSON round-trip drops those (and any `undefined` values), leaving a clean plain schema. The adapter then rewrites TypeBox's [extended types](#extended-types-typebox) into `x-mjst` hints.

### Zod

> [!IMPORTANT]
> **Zod 4 or later only.** The adapter relies on Zod's native `toJSONSchema`, which does not exist before Zod 4 (see [`src/zod-to-json-schema.ts`](./src/zod-to-json-schema.ts)). On Zod 3 you'll get a clear error rather than a silent miss.

```ts
import { z } from 'zod'
import { zodToJsonSchema } from '@amritk/adapters/zod-to-json-schema'

const User = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  createdAt: z.date(),
})

const jsonSchema = await zodToJsonSchema(User)
```

`z.date()` and `z.bigint()` have no JSON Schema representation and would make Zod's exporter throw; the adapter runs it with `unrepresentable: 'any'` and uses the `override` hook to rescue them into [`x-mjst`](#the-x-mjst-extension) hints. It also repairs two Zod 4 quirks along the way: it restores the length bound on fixed tuples (Zod emits a bare, unbounded `prefixItems`), and it merges an object **intersection** that Zod emits as an unsatisfiable `allOf` of `additionalProperties: false` branches into a single closed object.

### Valibot

```ts
import * as v from 'valibot'
import { valibotToJsonSchema } from '@amritk/adapters/valibot-to-json-schema'

const User = v.object({
  id: v.pipe(v.number(), v.integer()),
  name: v.pipe(v.string(), v.minLength(1)),
  createdAt: v.date(),
})

const jsonSchema = await valibotToJsonSchema(User)
```

Requires both `valibot` and `@valibot/to-json-schema`. As with Zod, `v.date()` / `v.bigint()` are rescued into `x-mjst` hints via the converter's `overrideSchema` hook. The converter runs in `errorMode: 'warn'`, so any other unsupported construct degrades to an open schema and is logged rather than throwing.

### Effect

```ts
import { Schema } from 'effect'
import { effectToJsonSchema } from '@amritk/adapters/effect-to-json-schema'

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  createdAt: Schema.DateFromSelf, // runtime Date — see the caveat below
})

const jsonSchema = await effectToJsonSchema(User)
```

Requires `effect@>=3`. A top-level `Schema.BigIntFromSelf` / `Schema.DateFromSelf` is rescued into an `x-mjst` hint; everything else goes through `JSONSchema.make`. **Read the [encoded-representation caveat](#effect-encodes-the-wire-representation) before choosing between `Schema.Date` and `Schema.DateFromSelf`** — it changes whether you get a `string` or a runtime `Date`.

---

## The `x-mjst` extension

JSON Schema's core vocabulary has no keyword for a runtime `Date` or a `bigint`. mjst carries those as a vendor extension, `x-mjst`, that the generators read to emit the right TypeScript type and runtime check. Every adapter maps to the **same** two hints, so a `Date` authored in any of the four libraries generates identically:

| Source construct | `x-mjst` hint | Generated handling |
|:---|:---|:---|
| a runtime `Date` | `{ instanceOf: 'Date' }` | typed as `Date`, checked with `instanceof` |
| a `bigint` | `{ primitive: 'bigint' }` | typed as `bigint`, checked with `typeof` |

Per library, the `Date` / `bigint` sources are:

| | `Date` → `instanceOf: 'Date'` | `bigint` → `primitive: 'bigint'` |
|:---|:---|:---|
| **TypeBox** | `Type.Date()` | `Type.BigInt()` |
| **Zod** | `z.date()` | `z.bigint()` |
| **Valibot** | `v.date()` | `v.bigint()` |
| **Effect** | `Schema.DateFromSelf` | `Schema.BigIntFromSelf` |

---

## Lossy constructs & widening warnings

Some source types have no faithful JSON Schema representation and are **not** rescued into an `x-mjst` hint. Rather than fail the whole conversion, the adapters widen those to "accept anything" (`{}`) — which means **the generated type is wider than the source schema** — and emit a `[mjst]` warning to stderr so the widening is visible, never silent. Behaviour per library:

- **Zod.** These Zod types become "accept anything": `symbol`, `nan`, `void`, `undefined`, `never`, `map`, `set`, `promise`, `function`. When any appear, the adapter logs, e.g.: *"[mjst] Zod adapter: function, symbol have no JSON Schema representation and became 'accept anything'. The generated type will be wider than the Zod schema."*
- **Valibot.** The converter runs in `errorMode: 'warn'`: an unsupported construct degrades to an open schema and `@valibot/to-json-schema` logs which one, so the widening is reported by the converter itself.
- **TypeBox.** An extended `type` string with no mapping (see below) is left unchanged with a warning: *"[mjst] TypeBox type '…' has no JSON Schema or x-mjst mapping; leaving it unchanged."*
- **Effect.** Effect does not widen — it is stricter. `JSONSchema.make` **throws** on a *nested* unrepresentable type (a `BigIntFromSelf` / `DateFromSelf` below the top level with no `jsonSchema` annotation). The adapter catches that and re-throws an actionable message pointing you at the fix: use the string-encoded `Schema.Date` / `Schema.BigInt`, or add a `jsonSchema` annotation to that field.

If any of these matter to your schema, prefer a representable alternative (e.g. model a set as an array) or add the library's own JSON Schema annotation.

---

## Caveats

### Extended types (TypeBox)

TypeBox emits non-standard `type` strings for its runtime classes (e.g. `Type.Date()` produces `{ type: 'Date' }`). The adapter recognises the seven core JSON Schema types and treats anything else in a `type` slot as a TypeBox **extended type**. The map of extended types it understands currently covers **only `Date` and `bigint`** (see [`src/typebox-to-json-schema.ts:11-19`](./src/typebox-to-json-schema.ts#L11-L19)):

| TypeBox extended `type` | mapped to |
|:---|:---|
| `Date` | `x-mjst` `instanceOf: 'Date'` |
| `bigint` | `x-mjst` `primitive: 'bigint'` |

Any other extended type (`Uint8Array`, `Symbol`, `Undefined`, …) is left untouched with the widening warning above; support is added by extending that map as the generators gain handling for more types.

### Effect encodes the *wire* representation

Effect models a value as a **decode/encode pair**, and `JSONSchema.make` describes the **encoded** (wire) representation — not the runtime type. This is the caveat most likely to surprise you:

- `Schema.Date` decodes a `Date` **from a string**, so it converts to a **`string`** schema — not a runtime `Date`. The adapter passes this through unchanged, because it accurately reflects what Effect expects on the wire.
- Only the `*FromSelf` variants — `Schema.DateFromSelf`, `Schema.BigIntFromSelf` — describe the runtime value itself, and those are the ones rescued into `x-mjst` runtime-type hints (see [`src/effect-to-json-schema.ts:63`](./src/effect-to-json-schema.ts#L63)).

So: want a generated `Date`? Author `Schema.DateFromSelf`. Want a string that Effect parses into a `Date`? Author `Schema.Date` and expect a `string` in the generated output. The same distinction applies to `Schema.BigInt` (→ `string`) vs `Schema.BigIntFromSelf` (→ `bigint`).

---

## Related packages

- [`@amritk/mjst`](../cli) — CLI that ingests these formats via `--input <format>`
- [`@amritk/generate-parsers`](../generate-parsers) · [`@amritk/generate-validators`](../generate-validators) · [`@amritk/generate-markdown`](../generate-markdown) · [`@amritk/generate-examples`](../generate-examples) — the generators these adapters feed
- [`@amritk/helpers`](../helpers) — defines the shared `x-mjst` extension

---

## License

[MIT](../../LICENSE)
