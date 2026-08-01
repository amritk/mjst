# @amritk/generate-examples — notes for AI coding agents

Programmatic API: turn a JSON Schema into test data — a fast-check arbitrary
(`FooArbitrary`) and a concrete example value (`fooExample`) per node, plus
types. Full reference is [README.md](./README.md).

> Pre-alpha: APIs and generated output change pre-1.0.

## Minimal example

```ts
import { buildExampleSchema } from '@amritk/generate-examples'

const schema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' }, age: { type: 'integer', minimum: 0 } },
  required: ['id'],
} as const

const files = await buildExampleSchema(schema, 'User') // → user.ts, index.ts
```

## Gotchas — where agents fail

1. **Generated arbitrary files `import * as fc from 'fast-check'`** — `fast-check`
   (`>=3`) is an **optional peer dependency** consumers must install. The static
   `fooExample` values have no runtime deps. A generated file whose schema uses
   `if`/`then`/`else`, `not`, `oneOf`, `patternProperties`, `propertyNames`,
   `dependentRequired`, `dependentSchemas`, `dependencies`, `minProperties`,
   `maxProperties`, or `contains` **also** imports `@amritk/runtime-validators`
   for its validating filter. That one is a `dependency` of this package, not a
   peer — the generator imports it too — so it resolves for the generator but not
   necessarily from the consumer's own tree, where the generated file lives.
   Under pnpm-strict or Yarn PnP, install it directly. It cannot be declared a
   peer as well: Bun rejects a workspace package listed as both, and
   `--frozen-lockfile` then fails repo-wide.
2. **`generateArbitrary` / `generateExampleConst` return source-code STRINGS**;
   **`deriveExample` returns an actual runtime VALUE.** Easy to confuse.
3. **A static example is validated against its own schema before it is emitted.**
   If it fails, it is written anyway (the module must compile) and the generator
   `console.warn`s, naming the type. That happens when the schema has no instance
   at all, or when the constraint is beyond the deriver (a `pattern` with
   lookarounds/backreferences, an unrecognized `format`). Use `FooArbitrary`
   there — it carries a runtime validating filter and stays correct.
4. **Unsupported keywords degrade silently:** `fc.anything()` in arbitraries,
   `null` in static examples — no error thrown.
5. **`deriveExample` memoizes each `$ref` per root document**, so the returned
   value can share sub-objects with the value derived for a sibling schema.
   Treat it as read-only.

Exports: `buildExampleSchema`, `generateArbitrary`, `generateExampleConst`,
`deriveExample`, `serializeValue`, `GeneratedFile`. Only the `.` entry.
Install: `bun add @amritk/generate-examples`.
