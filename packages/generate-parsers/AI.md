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
   `GeneratedFile[]` (`{ filename, content }`) yourself. `rootTypeName` becomes
   that filename (lowercased) as well as the `export type` name, so it must be a
   TypeScript identifier — `buildSchema` throws otherwise rather than hand you a
   path that escapes your output directory. Derive it with `@amritk/helpers`'
   `deriveRootTypeName`, which always produces one.
3. **Output is more than one file per `$def`:** always an `index.ts` barrel, and
   (unless `typesOnly`) runtime helper files.
4. **Default parsers COERCE invalid input to defaults** rather than throwing;
   pass `strict: true` (the 6th positional) to make them throw.
5. **Strict mode enforces the whole Draft 2020-12 assertion vocabulary** —
   including `unevaluatedProperties` / `unevaluatedItems`, `contains` bounds,
   `propertyNames`, `dependent*`, `patternProperties`, tuple `prefixItems`, and a
   `$ref`'s 2020-12 siblings — and is held against Ajv by differential fuzz. It
   deliberately differs on three points (`format` is an annotation, `multipleOf`
   uses a scaled tolerance, a type-less `properties` schema still requires an
   object); see the README.
6. **Strict generation FAILS LOUDLY on anything it cannot enforce** (e.g. a
   recursive `$ref` it would have to inline when ref imports are off). Catch the
   error and fall back to a coercing parser if that is not what you want.

Only the `.` entry (`buildSchema`, `GeneratedFile`, `ImportExtension`).
Install: `bun add @amritk/generate-parsers`.
