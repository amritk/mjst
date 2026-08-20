# AGENTS.md — @amritk/generate-validators

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Generates lightweight predicate validators (`validateFoo`) + types from a JSON
Schema.

## Commands

```bash
bun run --filter='@amritk/generate-validators' test
bun run --filter='@amritk/generate-validators' types:check
```

## Invariants — do not break these

- **Generated validators return the literal `true` on success**, `{ valid:
  false; errors }` on failure. Do not change the success sentinel — downstream
  code and docs check `result !== true`.
- **`buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?)`** returns
  `GeneratedFile[]` in memory; output always includes a shared
  `validation-result.ts` plus the `index.ts` barrel.
- Draft-07 input is auto-upgraded to 2020-12 — keep that path working.
- `NaN` fails a *constrained* number and satisfies a bare `{ "type": "number" }`.
  Every bound is emitted as the negated pass condition (`!(x >= minimum)`), which
  is what makes the first half true; the second matches Ajv. Both halves match
  `@amritk/runtime-validators` value-by-value, pinned in
  `interpreter-parity.test.ts` — do not "fix" either one without moving the
  interpreter with it.
- `format` deliberately emits no check (annotation, like the interpreter's
  default). `unevaluatedProperties`/`unevaluatedItems` *are* generated, as a flat
  coverage expression; four shapes still refuse (see `README.md`). The rule
  behind both is never to emit a validator that accepts what the interpreter
  rejects, so a *narrowing* keyword we cannot express fails generation rather
  than passing silently. Any new keyword lands on one side of that line or the
  other.
- Generation refuses a name it cannot emit rather than writing a file that will
  not compile: a definition that wants `validation-result.ts` or `index.ts`, one
  whose type name is `ValidationResult` / `ValidationError` (every generated file
  imports those), and any type name that is not a plain TypeScript identifier —
  which the root type name and the type suffix, both passed in verbatim, can be.
- Schema keywords are read with `@amritk/helpers/read-key`, never `'x' in
  schema`: an inherited keyword makes a different validator, and
  `polluted-prototype.test.ts` pins that it cannot.
- Nothing rewrites emitted text. A schema's own strings land in the output as
  data, so a `replaceAll` over a finished function rewrites *them* too —
  `schema-text-is-data.test.ts` pins it. Emit the final spelling first time.

Add a changeset for every change (`bunx changeset`).
