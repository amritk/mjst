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
   `fooExample` values have no runtime deps.
2. **`generateArbitrary` / `generateExampleConst` return source-code STRINGS**;
   **`deriveExample` returns an actual runtime VALUE.** Easy to confuse.
3. **A static example constrained only by `pattern` may not match the pattern** —
   use the arbitrary when pattern fidelity matters.
4. **Unsupported keywords degrade silently:** `fc.anything()` in arbitraries,
   `null` in static examples — no error thrown.

Exports: `buildExampleSchema`, `generateArbitrary`, `generateExampleConst`,
`deriveExample`, `serializeValue`, `GeneratedFile`. Only the `.` entry.
Install: `bun add @amritk/generate-examples`.
