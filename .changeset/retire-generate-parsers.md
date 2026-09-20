---
'@amritk/generate-parsers': minor
---

Deprecated. This package is now a compatibility shim over
[`@amritk/parsers`](https://github.com/amritk/mjst/tree/main/packages/parsers),
which owns the engine that used to live here and reaches every mode it had —
plus `check`, `coerce` and `repair` — through one `generate()` call.

Nothing breaks on upgrade: the exported function keeps its signature and emits
byte-identical output, verified across every positional option against the real
engine at the point it moved. But this is the last release, so migrate:

```ts
// before
import { buildSchema } from '@amritk/generate-parsers'

// after
import { generate } from '@amritk/parsers'
const files = await generate(schema, 'Document', {
  modes: ['types', 'parse'],
})
```
