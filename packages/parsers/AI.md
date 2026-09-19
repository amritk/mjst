# @amritk/parsers — notes for AI coding agents

One generator surface over mjst's types, guards, validators, coercers, repairers
and parsers. Composes [`@amritk/generate-validators`](../generate-validators) and
[`@amritk/generate-parsers`](../generate-parsers); it does not replace either.

> Pre-alpha: APIs and generated output change pre-1.0.

## Minimal example

```ts
import { generate } from '@amritk/parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const schema: JSONSchema = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
}

const files = await generate(schema, 'Document', { modes: ['types', 'guard', 'validate', 'repair'] })
// → document.ts, validation-result.ts, index.ts
```

## The modes

| mode | emits | value back | tells you | stops at |
|:---|:---|:---|:---|:---|
| `types` | `X` | — | — | — |
| `guard` | `isX` | — | a boolean | first problem |
| `validate` | `validateX` | — | every error | the end |
| `coerce` | `coerceX` | coerced | every error | the end |
| `repair` | `repairX` | repaired | repairs **and** errors | the end |
| `parse` | `parseX` | repaired | nothing (total) | never |
| `parseStrict` | `parseX` | as given | throws the first | first problem |

## Gotchas — where agents fail

1. **Options object, not positional booleans.** `generate(schema, typeName, options)`.
   The two packages underneath take long positional argument lists; this one does
   not, and you should not reach past it to them for a mode it already covers.
2. **The default is `['types', 'guard', 'validate']`** — read-only. Anything that
   rewrites a document (`coerce`, `repair`, `parse`) is opt-in.
3. **`parse` and `parseStrict` are mutually exclusive** and `generate` throws if
   you ask for both: they are one function name under two contracts.
4. **One type, two files.** The type is declared once, in `x.ts`, alongside the
   validator half. The parser half lands in `x.parse.ts` and imports the type. Do
   not expect `parseX` in `x.ts`, and do not expect a second `export type X`
   anywhere — there is exactly one.
5. **`repairX` reports `valid: true` for a *fully repaired* document**, with a
   non-empty `repairs`. `result.valid` alone does not mean the input was clean;
   check `repairs.length` when that matters.
6. **`guard` is the fail-fast mode and it is much cheaper on bad input** — it
   short-circuits and builds no error object. It is also, counter-intuitively,
   *not* faster than `validateX` on input that is valid, where both must check
   everything. Pick `guard` when the answer is a branch, `validate` when someone
   has to be told what to fix.

7. **It emits the composed packages' exact bytes.** A single-mode build is
   byte-identical to calling `@amritk/generate-validators` or
   `@amritk/generate-parsers` directly, so there is no runtime difference to
   reason about and no speedup to claim — do not tell a user this is faster. What
   it changes is that the whole matrix comes out as one type instead of two, and
   that a build asking for no validator mode ships no `validation-result.ts`.

Only the `.` entry. Install: `bun add @amritk/parsers`.
