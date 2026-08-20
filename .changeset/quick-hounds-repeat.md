---
'@amritk/generate-validators': minor
---

Stop reading schema text as code, and fix `uniqueItems` on values JSON cannot hold.

The emitters used to write `errors.push(` and let a `replaceAll` over the finished
function text rewrite it into the create-on-first-use form (and an unread
`(input: unknown` parameter into `(_input: unknown`). Both substrings are ordinary
schema content, so a schema that spelled one had it rewritten inside its own data:
`pattern: "errors.push(x)"` compiled to `/(errors ??= []).push(x)/`, a regex that
matches nothing, and an `enum` member or property name spelling it was compared
against a string nobody wrote. `isX` was built without the rewrite, so the two
disagreed on the same input. The error sink is now carried through the emitters,
so the final spelling is written the first time and no generated text is ever
rewritten. Output is byte-identical for every schema that does not spell one of
those substrings.

`uniqueItems` over provably-scalar items now dedupes with a bare `Set` instead of
a `JSON.stringify` projection: SameValueZero is JSON Schema's equality for
primitives exactly, where stringifying printed both `NaN` and `null` as `"null"`
and called `[NaN, null]` a duplicate pair.

The emitted `validation-result.ts` changes with it. `valuesEqual` now counts `NaN`
equal to itself, matching Ajv and `@amritk/runtime-validators`, and caps its walk
at 512 levels so a self-referential value returns a verdict instead of throwing a
`RangeError` out of a function whose signature promises a `ValidationResult`.
`allUnique` buckets by a structural hash before comparing, the same way the
interpreter does — an array of 4 000 distinct objects took 570ms of pairwise
comparison and now takes 7ms.
