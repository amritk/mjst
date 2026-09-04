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
2. **Small signature:** `buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?, schemas?, unknownKeys?)`
   — async, no `strict`/`typesOnly`/options object. Returns `GeneratedFile[]` in
   memory (you write them). `unknownKeys` (`'count-keys'` by default,
   `'count-enumerable'` for Node-only output) picks how a closed object's guard
   counts keys; nothing in the generated code detects its runtime.
3. **Output includes a shared `validation-result.ts`** (`ValidationError`,
   `ValidationResult`, helpers) plus the `index.ts` barrel.
4. **`NaN` fails a *constrained* number** (`minimum`/`maximum`/`multipleOf` all
   reject it) and satisfies a bare `{ "type": "number" }`, which is Ajv's answer
   too. Draft-07 schemas are auto-upgraded to 2020-12.
5. **`format` emits no check.** It stays an annotation, like the interpreter's
   default — but *not* like the interpreter run with `{ formats: 'all' }`
   (`@amritk/lint`, `createApi({ formats })`), which rejects strings a generated
   validator accepts. `unevaluatedProperties`/`unevaluatedItems` *are* generated;
   four shapes still refuse (coverage through a `$dynamicRef`, an unresolvable or
   cyclic `$ref` at the same instance location, a walk deeper than eight
   applicators, a node under an *inert* `additionalItems` — one with no array
   `items`, or with `prefixItems` alongside), and generation **throws** for those
   rather than widening the verdict.

Only the `.` entry. Install: `bun add @amritk/generate-validators`.
