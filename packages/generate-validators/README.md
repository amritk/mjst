# @amritk/generate-validators

> **Deprecated.** Use [`@amritk/validation`](https://www.npmjs.com/package/@amritk/validation) instead.
>
> This release is a compatibility shim: `buildValidatorSchema` keeps its signature and emits
> byte-identical output, so upgrading to it breaks nothing. It is the last
> release of this package.

## What this was

The predicate validator generator: given a JSON Schema (Draft 2020-12),
`buildValidatorSchema(rootSchema, rootTypeName, …options)` returned an array of
`{ filename, content }` records carrying a TypeScript type, a
`validateX(input)` reporting every error, and an `isX(input)` type guard.

## What replaces it

The engine did not go away — it moved. It now lives inside
[`@amritk/validation`](https://github.com/amritk/mjst/tree/main/packages/validation),
behind a single `generate()` call that reaches every mode this package had plus
the others, over one shared type declaration:

| mode | function | value back | tells you |
|:---|:---|:---|:---|
| `types` | — | — | — |
| `guard` | `isX` | — | a boolean, stopping at the first problem |
| `check` | `checkX` | — | the first error only |
| `validate` | `validateX` | — | every error |
| `coerce` | `coerceX` | coerced | every error |
| `repair` | `repairX` | repaired | the repairs it made, and any errors left |
| `parse` | `parseX` | repaired | nothing; never fails |
| `parseStrict` | `parseX` | as given | throws on the first problem |

## Before / after

```ts
// before
import { buildValidatorSchema } from '@amritk/generate-validators'

const files = await buildValidatorSchema(schema, 'Document')
```

```ts
// after
import { generate } from '@amritk/validation'

const files = await generate(schema, 'Document', { modes: ['types', 'guard', 'validate'] })
```

Both hand back `{ filename, content }[]`. The positional arguments become named
options — see the
[`@amritk/validation` README](https://github.com/amritk/mjst/tree/main/packages/validation#readme)
for the full table.
