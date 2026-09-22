# @amritk/generate-parsers

> **Deprecated.** Use [`@amritk/validation`](https://www.npmjs.com/package/@amritk/validation) instead.
>
> This release is a compatibility shim: `buildSchema` keeps its signature and emits
> byte-identical output, so upgrading to it breaks nothing. It is the last
> release of this package.

## What this was

The programmatic parser and type generator: given a JSON Schema (Draft 2020-12),
`buildSchema(rootSchema, rootTypeName, …options)` returned an array of
`{ filename, content }` records carrying a TypeScript type and, unless you asked
for types only, a parser function for it.

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
import { buildSchema } from '@amritk/generate-parsers'

const files = await buildSchema(schema, 'Document')
```

```ts
// after
import { generate } from '@amritk/validation'

const files = await generate(schema, 'Document', { modes: ['types', 'parse'] })
```

Both hand back `{ filename, content }[]`. The positional arguments become named
options — see the
[`@amritk/validation` README](https://github.com/amritk/mjst/tree/main/packages/validation#readme)
for the full table.

The three shapes `buildSchema` chose between are now modes: the default coercing
parser is `'parse'`, `strict: true` is `'parseStrict'`, and `typesOnly: true` is
`'types'` on its own.
