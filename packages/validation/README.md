<div align="center">

# @amritk/validation

**One generator surface over mjst's types, guards, validators, coercers, repairers and parsers.**

</div>

---

## Overview

`@amritk/validation` is the front door. Given a JSON Schema (Draft 2020-12) it emits
one coherent set of TypeScript files carrying whichever runtime entry points you
ask for — from a bare type, through a boolean guard and a full error report, to a
coercer, a repairer and a total parser.

Underneath it are **two** generator engines, not one: a validator, coercer and
repairer engine, and a parser and type engine. They shipped separately as
`@amritk/generate-validators` and `@amritk/generate-parsers` until this package
absorbed them, and keeping both is deliberate. They emit genuinely different
code for the value-producing modes: a parser fuses building the output with
checking it, and is several times faster for it; a validator keeps the passes
apart, and can therefore report what was wrong. Collapsing them into one emitter
would mean giving up one of those properties.

What makes one output directory possible is that both derive the TypeScript type
from the same `@amritk/helpers/generate-type-definition`, so the type is declared
**once** and every function in the output is talking about it.

---

## Installation

```bash
bun add @amritk/validation
```

---

## Usage

```typescript
import { generate } from '@amritk/validation'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const schema: JSONSchema = {
  type: 'object',
  properties: {
    retries: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
    name: { type: 'string', minLength: 3 },
  },
  required: ['retries', 'name'],
}

const files = await generate(schema, 'Config', {
  modes: ['types', 'guard', 'validate', 'coerce', 'repair', 'parse'],
})

for (const file of files) await Bun.write(`./generated/${file.filename}`, file.content)
```

---

## The modes

Each mode is a different answer to *how much may this do to my document, and what
do I get told*. They compose: ask for several and you get several functions over
one type, and every one that judges a value judges it with the same `validateX`,
so no two can disagree about whether a document is valid.

| mode | function | value back | tells you | stops at |
|:---|:---|:---|:---|:---|
| `types` | — | — | — | — |
| `guard` | `isX(input): input is X` | — | a boolean | the first problem |
| `validate` | `validateX(input)` | — | every error | the end |
| `coerce` | `coerceX(input)` | coerced | every error | the end |
| `repair` | `repairX(input)` | repaired | repairs **and** errors | the end |
| `parse` | `parseX(input)` | repaired | nothing | never fails |
| `parseStrict` | `parseX(input)` | as given | throws the first | the first problem |

**Validate only, fail fast or find every error.** `guard` is the fail-fast half:
it stops at the first thing wrong and builds no error object, which on invalid
input is dramatically cheaper than reporting. `validate` is the other half: every
error, each with a JSON Pointer, the keyword that rejected the value, and that
keyword's own values. Reach for `guard` when the answer is a branch and
`validate` when a human or an API client has to be told what to fix.

**Coerce and repair, with or without the errors.** `coerceX` and `repairX` hand
back the value *and* the diagnostics; `parseX` hands back only the value and
never fails. Coercion moves a value that is already right but written in the
wrong type; repair also substitutes a value the schema supplies for one that
cannot be coerced, and reports the validator's own errors as the repairs.

`parse` and `parseStrict` are the same function name under two contracts, so
asking for both is an error rather than a silent choice.

---

## API

### `generate(rootSchema, rootTypeName, options?)`

| Parameter | Type | Default | Description |
|:---|:---|:---|:---|
| `rootSchema` | `JSONSchema` | — | The root schema. `$ref` and `$dynamicRef` are resolved recursively. |
| `rootTypeName` | `string` | — | Name for the root type (e.g. `"Config"`). |
| `options.modes` | `Mode[]` | `['types', 'guard', 'validate']` | Which entry points to emit. The default is read-only; anything that rewrites a document is opt-in. |
| `options.typeSuffix` | `string` | `''` | Suffix on every `$ref`-derived type name. The root name is untouched. |
| `options.schemas` | `Record<string, unknown>` | — | Documents you have already loaded, keyed by the URI a `$ref` names them by. |
| `options.unknownKeys` | `'count-keys' \| 'count-enumerable'` | `'count-keys'` | How a closed object's fast path proves it carries no undeclared key. |
| `options.formats` | `'all' \| string[]` | — | String `format`s the validators enforce. Unset leaves `format` an annotation. |
| `options.branchErrors` | `boolean` | `false` | Explain a failing `anyOf` / `oneOf` with the branch it plainly meant. |
| `options.stripUnknown` | `boolean` | `false` | Build each parsed result from the declared properties only. |
| `options.readonly` | `boolean` | `false` | Emit `readonly` type members. |
| `options.caseInsensitive` | `boolean` | `false` | Normalize a mis-cased string onto an `enum` member it matches. |
| `options.helpersMode` | `'package' \| 'embedded'` | `'package'` | Where the parser half gets its runtime helpers. |
| `options.extensions` | `SchemaExtensions` | — | Schema extensions, passed through to the parser half. |

Returns: `Promise<GeneratedFile[]>` where `GeneratedFile = { filename: string; content: string }`.

---

## Output layout

```
config.ts         the type, plus isX / validateX / coerceX / repairX
config.parse.ts   parseX, importing the type from ./config.js
validation-result.ts   the shared error and result types, and the runtime helpers
index.ts          a barrel over all of it
```

The type lives in `config.ts` because that is where a reader looks for it. The
parser half moves to `config.parse.ts` because both generators name their file
after the schema and one of them has to give way. There is exactly one
`export type Config` in the output, whatever combination of modes you asked for
— which the test suite asserts, over a corpus of schema shapes, by compiling the
result under this repo's own flags.

Ask for no validator mode and there is nothing to collide with, so the parser
keeps both its own filename and the type it already authored, and no
`validation-result.ts` is emitted at all — a parse-only build has nothing that
could import its 17 KiB of error types and runtime helpers.

---

## Is it faster?

No, and it should not be. Ask this package for one mode and it emits **the exact
bytes** the engine that owns that mode emits — which the test suite pins per
mode, by fingerprint, not by reading the output. Identical code cannot
run at a different speed, so there is no runtime claim to make here and none is
made. `bun run bench` measures it anyway, and the deltas wander either side of
zero between runs, which is what process-level variance looks like when there is
no underlying difference.

What does change is the cold side, and only in the direction you would hope:

| | before (both engines directly) | after |
|:---|:---|:---|
| codegen for the whole matrix | 2.9 ms | 2.7 ms |
| emitted bytes | 46.0 KiB | 45.8 KiB |
| files | 7 | 6 |
| declarations of `Order` | **2** | **1** |
| per-mode codegen | — | equal or slightly lower |
| per-mode bytes | — | identical |

The one that matters is the last row of the middle block. Reaching every mode
used to mean running both generators yourself and shipping two trees for one
schema, including two declarations of the same type — structurally
interchangeable, but two things to keep in step. Now there is one.

---

## Related packages

- [`@amritk/helpers`](../helpers) — the shared type definition and fallback tables both engines read
- [`@amritk/mjst`](../cli) — the command-line interface

---

## License

MIT
