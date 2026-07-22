# @amritk/adapters — notes for AI coding agents

Convert schemas authored in TypeBox, Zod, Valibot, or Effect into Draft 2020-12
JSON Schema — the single input shape the mjst generators consume. Full
reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions.

## Minimal example

```ts
import { getAdapter } from '@amritk/adapters/get-adapter'
import { z } from 'zod' // Zod 4+

const User = z.object({ id: z.number().int(), name: z.string().min(1) })

const adapter = getAdapter('zod')
const jsonSchema = await adapter.toJSONSchema(User) // always await
```

## Gotchas — where agents fail

1. **No barrel export.** You CANNOT `import { zodToJsonSchema } from '@amritk/adapters'`.
   Import from the specific subpath (`@amritk/adapters/zod-to-json-schema`) or
   use `@amritk/adapters/get-adapter`.
2. **Adapters take the loaded schema VALUE, not a file path.** Loading the module
   is the caller's job.
3. **`getAdapter('json')` throws** — `'json'` is a valid `SourceFormat` but has no
   adapter (JSON Schema is read directly). Only `typebox` / `zod` / `valibot` /
   `effect` resolve.
4. **Source libraries are optional peer deps**, imported dynamically. **Zod must
   be v4+** (`toJSONSchema` doesn't exist earlier). Always `await` — even
   TypeBox's synchronous path is typed to allow a Promise.
5. **Unrepresentable constructs widen to `{}`** with a stderr `[mjst]` warning
   (Effect throws on nested ones). `date` / `bigint` become `x-mjst` hints. Pass
   `{ strict: true }` to throw instead of widening.

## Subpaths

`@amritk/adapters/get-adapter`, `.../typebox-to-json-schema`,
`.../zod-to-json-schema`, `.../valibot-to-json-schema`,
`.../effect-to-json-schema`, `.../adapter` (types), `.../source-format` (types).
Install: `bun add @amritk/adapters` (+ your source library).
