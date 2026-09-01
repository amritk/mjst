---
'@amritk/helpers': minor
'@amritk/generate-parsers': patch
'@amritk/generate-validators': patch
---

Give the numeric bound keywords one home, and pin the generated parsers to the
interpreter's verdict.

`minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` have exactly one
rule that is easy to get wrong: a bound must be spelled as the *pass* condition
and negated (`!(x >= min)`), never as a failure condition directly (`x < min`).
The two are identical for every ordinary number and opposite for `NaN`, which
compares `false` against every relational operator — so the direct form silently
*accepts* a `NaN` the interpreter and Ajv both reject. `@amritk/generate-
validators` drifted on precisely this once already.

The rule now lives in `@amritk/helpers/numeric-bound-check`, next to
`multiple-of-check`, and the four emitters that restated it —
`generate-validator-function` (both its error-collecting and guard forms),
`generate-schema-checks`, and `generate-strict-assertion` — call it instead.
Emitted output is unchanged apart from parentheses.

`@amritk/generate-parsers` also gains an `interpreter-parity.test.ts`, the
coverage gap that let the drift happen in the first place: its differential
suites fuzz against Ajv over inputs built from the schema, and those inputs are
JSON, which cannot hold a `NaN`, an `±Infinity`, or a value large enough to
overflow a `multipleOf` quotient. The new test runs the generated strict parser
and the runtime interpreter over exactly those values and requires the same
verdict.
