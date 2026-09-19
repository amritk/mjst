<div align="center">

# @amritk/generate

**One generator surface over mjst's types, guards, validators, coercers, repairers and parsers.**

</div>

---

## Overview

`@amritk/generate` is the front door. Given a JSON Schema (Draft 2020-12) it emits
one coherent set of TypeScript files carrying whichever runtime entry points you
ask for — from a bare type, through a boolean guard and a full error report, to a
coercer, a repairer and a total parser.

It **composes** [`@amritk/generate-validators`](../generate-validators) and
[`@amritk/generate-parsers`](../generate-parsers) rather than replacing them. That
is deliberate. The two emit genuinely different code for the value-producing
modes: a parser fuses building the output with checking it, and is several times
faster for it; a validator keeps the passes apart, and can therefore report what
was wrong. Collapsing them into one emitter would mean giving up one of those
properties. Composing keeps both.

What makes one output directory possible is that both derive the TypeScript type
from the same `@amritk/helpers/generate-type-definition`, so the type is declared
**once** and every function in the output is talking about it.

---

## Installation

```bash
bun add @amritk/generate
```

---

## Usage

```typescript
import { generate } from '@amritk/generate'
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

---

## Related packages

- [`@amritk/generate-validators`](../generate-validators) — the validator, coercer and repairer engine
- [`@amritk/generate-parsers`](../generate-parsers) — the parser and type engine
- [`@amritk/helpers`](../helpers) — the shared type definition and fallback tables both read
- [`@amritk/mjst`](../cli) — the command-line interface

---

## License

MIT
