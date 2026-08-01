---
'@amritk/runtime-validators': patch
'@amritk/generate-parsers': patch
'@amritk/generate-validators': patch
'@amritk/resolve-refs': patch
---

Measure every schema-consuming package against the official JSON Schema Test
Suite, the way `@amritk/yaml` is measured against the YAML test suite.

The required Draft 2020-12 tests (46 files, 1299 cases) are vendored under
`fixtures/json-schema-test-suite`, and four packages now run them on every build.
Each carries an expected-failure list naming every case it does not pass and why,
and each suite fails when a case moves in **either** direction — a regression
breaks the build, and so does a case that starts passing while its entry stays
behind. Nothing is published: the corpus and the harnesses live outside every
`files` list.

| package | measured on | rate |
| --- | --- | --- |
| `@amritk/runtime-validators` | `validate` and `validateGuard` verdicts | 1183 / 1299 (91.1%) |
| `@amritk/generate-parsers` | strict parsers, generated → linked → executed | 1141 / 1299 (87.8%) |
| `@amritk/generate-validators` | generated predicate validators, likewise | 818 / 1299 (63.0%) |
| `@amritk/resolve-refs` | verdict preserved after inlining (`$ref` corpus) | 105 / 107 (98.1%) |

The generators are measured through the code they emit, not the source text they
emit: each suite schema is generated whole, compiled, and linked in memory, so the
`$ref`'d sibling files and the embedded runtime helpers run too. `resolve-refs`
has no verdicts of its own, so it is held to semantic preservation — the resolved
document must accept exactly what the original did, judged by
`@amritk/runtime-validators` over the cases the interpreter already answers
correctly.

What the numbers document, now that they exist:

- **`runtime-validators`** — 111 of its 116 failures are one cause: a `$ref` that
  only resolves by applying `$id` as a base URI. It throws on those rather than
  guessing, so none of them can mis-validate. The rest are `contains` annotations
  feeding `unevaluatedItems` (4) and `$vocabulary` (1).
- **`generate-parsers`** — 92 of 158 are the generator refusing to emit at all,
  which costs a build error rather than a wrong verdict. The other 66 are real:
  composition with no discriminator, `required` compiling to `in` (so an inherited
  `toString` reads as present), `unevaluated*` annotation gaps, and `$ref`s that
  resolve to the wrong definition under `$id` scoping.
- **`generate-validators`** — the low number has one dominant cause worth knowing
  about: a schema with no root `type` compiles to a validator that accepts
  everything, so `{ minLength: 2 }` and `{ required: ['a'] }` are not enforced.
  Now documented in the README rather than discovered in production.
- **`resolve-refs`** — the two failures are the suite's own "naive replacement of
  `$ref` with its destination is not correct" group: a `$ref`-shaped object inside
  an `enum` is data, and inlining it changes what the schema matches.
