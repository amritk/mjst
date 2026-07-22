# @amritk/runtime-validators — notes for AI coding agents

Eval-free runtime JSON Schema validation: interpret a schema discovered at
runtime — no `new Function`, no build step, runs under strict CSP. Full
reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions.

## Minimal example

```ts
import { validate, validateGuard, assert } from '@amritk/runtime-validators'

const schema = {
  type: 'object',
  properties: { id: { type: 'integer' }, name: { type: 'string', minLength: 1 } },
  required: ['id', 'name'],
  additionalProperties: false,
} as const

const validator = validate(schema)          // (input) => true | { valid: false; errors }
const result = validator({ id: 1, name: 'Ada' })
if (result !== true) console.error(result.errors)

const isUser = validateGuard(schema)        // (input) => input is User  (boolean guard)
const user = assert(schema, { id: 1, name: 'Ada' }) // returns typed value OR throws
```

## Gotchas — where agents fail

1. **Success is the literal `true`, not `{ valid: true }`.** For `validate`,
   check `if (result !== true)`; the failure case is `{ valid: false, errors }`.
2. **`assert(schema, value)` — the value is the 2nd positional arg.** `validate`
   and `validateGuard` take only the schema and return a function.
3. **Only local `$ref`s resolve** (`#/$defs/x`, `#anchor`, incl. recursion).
   Remote / cross-file refs are NOT fetched — bundle first with
   `@amritk/resolve-refs`, then validate the dereferenced document.
4. **`format` is opt-in.** Unlisted formats are treated as annotations (like
   Ajv); pass `{ formats: 'all' }` or a list to enforce.
5. **Write the schema `as const`** for type inference. Wrong regime: this is a
   cold/few-values interpreter; for one schema × millions of values, use Ajv (or
   `@amritk/generate-validators` for generated straight-line code).

Exports: `validate`, `validateGuard`, `assert`, and the types `Validator`,
`Guard`, `ValidationError`, `ValidationResult`, `FromSchema`, `Infer`,
`ValidateOptions`. Only the `.` entry. Install: `bun add @amritk/runtime-validators`.
