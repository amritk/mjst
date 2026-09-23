# @amritk/validation — notes for AI coding agents

One generator surface over mjst's types, guards, validators, coercers, repairers
and parsers. It owns both generator engines: the validator/coercer/repairer one
and the parser/type one, which used to ship as `@amritk/generate-validators` and
`@amritk/generate-parsers` and are now internal modules here.

> Pre-alpha: APIs and generated output change pre-1.0.

## Minimal example

```ts
import { generate } from '@amritk/validation'
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
| `check` | `checkX` | — | the first error | first problem |
| `coerce` | `coerceX` | coerced | every error | the end |
| `repair` | `repairX` | repaired | repairs **and** errors | the end |
| `parse` | `parseX` | repaired | nothing (total) | never |
| `parseStrict` | `parseX` | as given | throws the first | first problem |

## The same modes from the CLI

Every mode is reachable from `mjst` without dropping to the programmatic API:

| mode | flags |
|:---|:---|
| `types` | `--types-only` (alone), otherwise always emitted |
| `guard`, `validate` | `--validators`, or `--validators-only` for no parser |
| `check` | `--check` |
| `coerce` | `--coerce` |
| `repair` | `--repair` (emits `coerceX` too) |
| `parse` | the default on any run that is not `--types-only`/`--validators-only` |
| `parseStrict` | `--strict` |

`--validators-only` is this package's own default (`['types', 'guard', 'validate']`)
spelled as a flag: everything that judges a document, nothing that builds one.

## Gotchas — where agents fail

1. **Options object, not positional booleans.** `generate(schema, typeName, options)`.
   The two engines underneath take long positional argument lists; this is the
   only entry point, and they are not reachable from outside the package.
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
7. **`check` is the middle of those two, and it returns `validateX`'s type.**
   `checkX` hands back the same `true | { valid: false, errors }`, with exactly
   one error in it — the one `validateX` would have reported first, same `path`,
   `keyword` and `params` — so error-handling code is shared between the two.
   Pick it when a failure has to be reported but only the first thing wrong
   matters. Do not build it by hand out of the other two: `isX(v) ? true :
   validateX(v)` pays for both passes and is no faster than `validateX`.

8. **It emits each engine's exact bytes.** A single-mode build is byte-identical
   to what that engine emitted when it was its own package, so there is no runtime
   difference to reason about and no speedup to claim — do not tell a user this is
   faster. What it changes is that the whole matrix comes out as one type instead
   of two, and that a build asking for no validator mode ships no
   `validation-result.ts`.

9. **`coerceX` is not Ajv's `coerceTypes`, on purpose.** It never modifies its
   input (no defensive clone needed), never coerces `null` in either direction,
   and reads only clean numerals as numbers (`" "`, `"0x10"`, `"Infinity"` are
   rejected). It coerces inside `anyOf`/`oneOf`/`allOf`/`if`: a union branch the
   value already matches wins uncoerced (so `false` stays `false` under
   `anyOf: [string, { const: false }]`, where Ajv answers `"false"`), and two
   branches that would coerce to different values leave it as written. Do not
   tell a user a value will come out the way Ajv would produce it inside a union.

Only the `.` entry. Install: `bun add @amritk/validation`.
