---
'@amritk/helpers': minor
'@amritk/mjst': patch
---

Generated types no longer reject instances an `if`/`then` conditional accepts.

An `if` is a test, not a requirement, and its `then` binds only the instances
that pass the test. The type generator used to fold the `if` and `then` property
blocks into the surrounding object as *required* properties, and merged an
`else` in beside them. `{ allOf: [{ if: { a: true }, then: { b: true } }] }` next
to optional `a` and `b` emitted `{ a?: boolean; b?: boolean } & { a: true; b:
true }`, so `{}` and `{ a: false }` — both valid — failed to type-check; the bare
form emitted `{ a: true; b: true }` outright. The runtime validators and parsers
were already right; only the declared type was wrong.

**Lowering chosen: a union, with a sound fallback.** A conditional now lowers to
`(if ∧ then) | (¬if ∧ else)`:

- The matched branch folds `if` and `then` into one literal, requiring only
  the keys their own `required` lists name, with a `then` `$ref` intersected
  onto that branch alone (`({ kind: "a" } & Extra) | { kind?: "b" }`).
- The unmatched branch is the negation of the test, spelled against the finite
  values the tested property may hold — a `boolean`, `enum`, `const` or `null`
  type declared in the schema's own `properties`, or in the composing schema's
  when the conditional is an inline `allOf` member — intersected with `else`
  when there is one. So the example above becomes `{ a?: boolean; b?: boolean }
  & ({ a: true; b: true } | { a?: false })`, which TypeScript narrows on the
  way the schema does.
- When the unmatched side cannot be spelled — the tested property is a string,
  the test is a `$ref` or a composition, and there is no `else` — the
  conditional is **dropped** from the type, which is what 0.7.1 did for the
  `allOf`-wrapped form. Lossy but sound: nothing the schema accepts is refused.
  A `$defs` entry that is nothing but an `if`/`then` (OpenAPI's `type-http`)
  therefore emits `{}`, where it used to emit an intersection that rejected
  every other security-scheme type.

An `allOf` member that is only its conditional renders as that union rather than
as `{} & (…)`, and `if: true` / `if: false` take their decided branch.
