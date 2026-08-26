# @amritk/asyncapi — notes for AI coding agents

Extract every message payload/headers schema from an AsyncAPI 2.x/3.0 document
as self-contained JSON Schema 2020-12, ready for the mjst generators. Full
reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions.

## Minimal example

```ts
import { extractAsyncApi, listMessageSchemas } from '@amritk/asyncapi'

const model = extractAsyncApi(parsedDocument) // takes a VALUE, not a path
const schemas = listMessageSchemas(model)
// → [{ subDir: 'channels/lighting-measured/light-measured', rootTypeName: 'LightMeasured', schema }, ...]
```

## Gotchas — where agents fail

1. **It takes an already-parsed document.** No filesystem, no YAML, no network —
   parse with `@amritk/yaml` / `JSON.parse` and resolve cross-file refs with
   `@amritk/resolve-refs` *before* calling. External `$ref`s still present are
   reported as issues, not fetched.
2. **Problems are collected, not thrown.** Read `model.issues`; only "this is
   not an AsyncAPI document" throws. An Avro/Protobuf `schemaFormat` skips that
   one schema with an issue.
3. **Directions are application-relative.** 2.x `publish` → `receive`,
   `subscribe` → `send` (the app is the server). Absent when no operation names
   the message.
4. **Extracted schemas are copies.** `#/components/schemas/X` refs are rebased
   to `#/$defs/X` with components copied in per message — mutating one
   message's schema never affects another.
5. **Root type names come from message identity**, not schema `title` — two
   messages titled "Event" stay distinct.
