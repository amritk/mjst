# AGENTS.md — the validator engine

Contributor guide for AI agents editing **this directory**, the validator,
coercer and repairer engine inside `@amritk/validation`. Repo-wide rules:
[`../../../../AGENTS.md`](../../../../AGENTS.md). Consuming the package? See
[`AI.md`](../../AI.md).

Generates lightweight predicate validators (`validateFoo`, `isFoo`, and on
request `checkFoo`, `coerceFoo`, `repairFoo`) + types from a JSON Schema. It is
internal: nothing outside `@amritk/validation` imports it, and `src/generate.ts`
is its only caller.

## Commands

```bash
bun run --filter='@amritk/validation' test
bun run --filter='@amritk/validation' types:check
```

## Invariants — do not break these

- **Generated validators return the literal `true` on success**, `{ valid:
  false; errors }` on failure. Do not change the success sentinel — downstream
  code and docs check `result !== true`.
- **`buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?, schemas?,
  unknownKeys?, formats?, coerce?, branchErrors?, repair?, importExt?, check?)`**
  returns `GeneratedFile[]` in memory; output always includes a shared
  `validation-result.ts` plus the `index.ts` barrel, and a `formats.ts` when an
  enforced format is called. The parameters are positional and append-only;
  `src/generate.ts` maps `GenerateOptions` onto them.
- Draft-07 input is auto-upgraded to 2020-12 — keep that path working.
- `NaN` fails a *constrained* number and satisfies a bare `{ "type": "number" }`.
  Every bound is emitted as the negated pass condition (`!(x >= minimum)`), which
  is what makes the first half true; the second matches Ajv. Both halves match
  `@amritk/runtime-validators` value-by-value, pinned in
  `interpreter-parity.test.ts` — do not "fix" either one without moving the
  interpreter with it.
- `format` emits no check unless the `formats` option names it (an annotation by
  default, like the interpreter's). `unevaluatedProperties`/`unevaluatedItems`
  *are* generated, as a flat coverage expression; four shapes still refuse —
  coverage through a `$dynamicRef`, an unresolvable or cyclic `$ref`, a walk
  deeper than eight applicators, and a node under an inert `additionalItems`
  (see `assert-unevaluated-generatable.ts`). The rule behind both is never to
  emit a validator that accepts what the interpreter rejects, so a *narrowing*
  keyword we cannot express fails generation rather than passing silently. Any
  new keyword lands on one side of that line or the other.
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

- An object with eight or more optional properties reads them with one
  `for…in` + `switch` over the instance's keys (`planKeyDispatch`), not a
  named read per declared property, which is what a document of varied shapes
  pays for most. Only the *read* moves: every check still runs in declared
  order from a local, so errors and their order are unchanged, and
  `key-dispatch.test.ts` pins both against the interpreter. Prototype-member
  names keep their own-property read.
- Patterns reach generated code through `regexTest` (`@amritk/helpers`), which
  turns a literal pattern (`^x-`, `^\$ref$`) into a string comparison. Emit
  sites take it rather than writing `${regexLiteral(p)}.test(…)`, and the
  subject must already be known to be a string.
- **The repairing half has two engines over one lookup.** `repairXAt`
  (`generate-repair-function.ts`) answers what a position repairs to. The
  single-pass walk (`generate-repair-walk.ts`) is emitted only when
  `repair-walkable.ts` clears *every* definition in the graph — one walk calls
  the next across files — and otherwise `repairX` runs the validate-and-repair
  loop. A keyword lands in the walk only if the walk repairs it exactly as the
  loop would; anything repaired elsewhere than the position that reports it
  (`minItems` pads, `propertyNames` names a key) goes on the blocking list.
  the "walk against validateX" suite in `repair-walk.test.ts` pins that every error
  `validateX` reports, the walk reports too. The runtime both engines share is
  `repair-runtime.ts`: a plain template, so it holds no backticks and no `${`.

Add a changeset for every change (`bunx changeset`).
