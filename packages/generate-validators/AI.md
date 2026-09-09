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
2. **Small signature:** `buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?, schemas?, unknownKeys?, formats?)`
   — async, no `strict`/`typesOnly`/options object. Returns `GeneratedFile[]` in
   memory (you write them). `unknownKeys` (`'count-keys'` by default,
   `'count-enumerable'` for Node-only output) picks how a closed object's guard
   counts keys; nothing in the generated code detects its runtime.
3. **Output includes a shared `validation-result.ts`** (`ValidationError`,
   `ValidationResult`, helpers) plus the `index.ts` barrel — and a `formats.ts`
   when `formats` is passed. Each error is
   `{ message, path, keyword, params }`, the shape
   `@amritk/runtime-validators` reports, so branch on `keyword` rather than
   matching message text.
4. **`NaN` fails a *constrained* number** (`minimum`/`maximum`/`multipleOf` all
   reject it) and satisfies a bare `{ "type": "number" }`, which is Ajv's answer
   too. Draft-07 schemas are auto-upgraded to 2020-12.
5. **`format` emits no check unless you pass `formats`.** By default it stays an
   annotation, like the interpreter given no formats — but *not* like the
   interpreter run with `{ formats: 'all' }` (`@amritk/lint`,
   `createApi({ formats })`), which rejects strings such a validator accepts.
   Pass `formats` (`'all'` or a list, or `--formats` on the CLI) and both
   `validateX` and `isX` check them, against a `formats.ts` emitted alongside.
   Set it to whatever validates the same schemas at runtime. `unevaluatedProperties`/`unevaluatedItems` *are* generated;
   four shapes still refuse (coverage through a `$dynamicRef`, an unresolvable or
   cyclic `$ref` at the same instance location, a walk deeper than eight
   applicators, a node under an *inert* `additionalItems` — one with no array
   `items`, or with `prefixItems` alongside), and generation **throws** for those
   rather than widening the verdict.

Only the `.` entry. Install: `bun add @amritk/generate-validators`.
