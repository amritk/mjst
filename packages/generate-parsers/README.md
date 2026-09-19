# @amritk/generate-parsers

> **Deprecated.** Use [`@amritk/parsers`](../parsers) instead.

## What this was

The programmatic parser and type generator: given a JSON Schema (Draft 2020-12),
`buildSchema(rootSchema, rootTypeName, …options)` returned an array of
`{ filename, content }` records carrying a TypeScript type and, unless you asked
for types only, a parser function for it.

## What replaces it

The engine did not go away — it moved. It now lives inside
[`@amritk/parsers`](../parsers), behind a single `generate()` call that reaches
the same parser output plus the guard, validator, coercer and repairer modes,
and declares the type once for all of them.

The versions already on npm stay there, deprecated. Nothing is published from
this directory any more.

## Before / after

```ts
// before
import { buildSchema } from '@amritk/generate-parsers'

const files = await buildSchema(schema, 'Document')
```

```ts
// after
import { generate } from '@amritk/parsers'

const files = await generate(schema, 'Document', { modes: ['parse'] })
```

Both hand back `{ filename, content }[]`. The positional arguments become named
options, and the three shapes `buildSchema` chose between are now modes:

| before | after |
|:---|:---|
| default (coercing parser) | `modes: ['parse']` |
| `strict: true` | `modes: ['parseStrict']` |
| `typesOnly: true` | `modes: ['types']` |

See the [`@amritk/parsers` README](../parsers/README.md) for the full mode table
and options.
