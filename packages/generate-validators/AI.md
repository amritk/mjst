# @amritk/generate-validators — notes for AI coding agents

Programmatic API: generate lightweight predicate validators (`validateFoo(input)`)
plus types from a JSON Schema. Full reference is [README.md](./README.md).

> Pre-alpha: APIs and generated output change pre-1.0.

## Minimal example

```ts
import { buildValidatorSchema } from '@amritk/generate-validators'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const schema: JSONSchema = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
}

const files = await buildValidatorSchema(schema, 'Document')
// → document.ts, validation-result.ts, index.ts
```

## Gotchas — where agents fail

1. **Success is the literal `true`, not `{ valid: true }`.** A generated
   `validateFoo` returns `true | { valid: false; errors: ValidationError[] }`.
   Check `if (result !== true)` for the failure path — `if (result.valid)` is
   wrong.
2. **Small signature:** `buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?)`
   — async, no `strict`/`typesOnly`/options. Returns `GeneratedFile[]` in memory
   (you write them).
3. **Output includes a shared `validation-result.ts`** (`ValidationError`,
   `ValidationResult`, helpers) plus the `index.ts` barrel.
4. **`NaN` satisfies numeric bounds** (`minimum`/`maximum`/`multipleOf`) — differs
   from Ajv. Draft-07 schemas are auto-upgraded to 2020-12.

Only the `.` entry. Install: `bun add @amritk/generate-validators`.
