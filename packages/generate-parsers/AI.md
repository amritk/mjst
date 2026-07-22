# @amritk/generate-parsers — notes for AI coding agents

Programmatic API: turn a JSON Schema (Draft 2020-12) into TypeScript type
definitions plus optional runtime parser functions. Full reference is
[README.md](./README.md). (Most users want the [`mjst` CLI](../cli) instead.)

> Pre-alpha: APIs and generated output change pre-1.0.

## Minimal example

```ts
import { buildSchema } from '@amritk/generate-parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const schema: JSONSchema = { type: 'object', properties: { title: { type: 'string' } } }

const files = await buildSchema(schema, 'Document')
// files → [{ filename: 'document.ts', content: '…' }, { filename: 'index.ts', content: '…' }, …]
```

## Gotchas — where agents fail

1. **`buildSchema` is `async` and takes POSITIONAL args, no options object.** The
   full signature is
   `buildSchema(rootSchema, rootTypeName, extensions?, typesOnly?, logWarnings?, strict?, helpersMode?, helpersImportPrefix?, readonly?, stripUnknown?, typeSuffix?, importExt?, caseInsensitive?)`.
   To set a later flag you must pass every intervening positional. (The README's
   short form omits the trailing seven.)
2. **It returns files in memory — it does NOT write to disk.** You write the
   `GeneratedFile[]` (`{ filename, content }`) yourself.
3. **Output is more than one file per `$def`:** always an `index.ts` barrel, and
   (unless `typesOnly`) runtime helper files.
4. **Default parsers COERCE invalid input to defaults** rather than throwing;
   pass `strict: true` (the 6th positional) to make them throw.

Only the `.` entry (`buildSchema`, `GeneratedFile`, `ImportExtension`).
Install: `bun add @amritk/generate-parsers`.
