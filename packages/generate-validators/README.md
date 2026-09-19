# @amritk/generate-validators

> **Deprecated.** Use [`@amritk/parsers`](../parsers) instead.

## What this was

The programmatic validator generator: given a JSON Schema (Draft 2020-12),
`buildValidatorSchema(rootSchema, rootTypeName, …options)` returned an array of
`{ filename, content }` records carrying a TypeScript type, a
`validateFoo(input)` reporting every error, an `isFoo(input)` type guard, and
optionally a fail-fast `checkFoo(input)`.

## What replaces it

The engine did not go away — it moved. It now lives inside
[`@amritk/parsers`](../parsers), behind a single `generate()` call that reaches
the same validator output plus the coercer, repairer and parser modes, and
declares the type once for all of them.

The versions already on npm stay there, deprecated. Nothing is published from
this directory any more.

## Before / after

```ts
// before
import { buildValidatorSchema } from '@amritk/generate-validators'

const files = await buildValidatorSchema(schema, 'Document')
```

```ts
// after
import { generate } from '@amritk/parsers'

const files = await generate(schema, 'Document', { modes: ['types', 'guard', 'validate'] })
```

Both hand back `{ filename, content }[]`, and those three modes are
`generate()`'s default, so the options object can be dropped entirely. The
remaining entry points are modes too: `check` for the fail-fast report,
`coerce` and `repair` for the value-producing ones.

See the [`@amritk/parsers` README](../parsers/README.md) for the full mode table
and options.
