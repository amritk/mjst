---
'@amritk/runtime-validators': patch
'@amritk/generate-parsers': patch
'@amritk/generate-validators': patch
'@amritk/resolve-refs': patch
---

Measure every schema-consuming package against the official JSON Schema Test
Suite, the way `@amritk/yaml` is measured against the YAML test suite

The required Draft 2020-12 tests (46 files, 383 groups, 1299 cases) are vendored
under `fixtures/json-schema-test-suite`, and four packages now run them on every
build. Each carries an expected-failure list naming every case it does not pass
and why, and each suite fails when a case moves in **either** direction — a
regression breaks the build, and so does a case that starts passing while its
entry stays behind. Nothing is published: the corpus and the harnesses live
outside every `files` list.

| package | measured on | rate |
| --- | --- | --- |
| `@amritk/runtime-validators` | `validate` and `validateGuard` verdicts | 1250 / 1299 (96.2%) |
| `@amritk/generate-parsers` | strict parsers, generated → linked → executed | 1180 / 1299 (90.8%) |
| `@amritk/generate-validators` | generated predicate validators, likewise | 987 / 1299 (76.0%) |
| `@amritk/resolve-refs` | verdict preserved after inlining (`$ref` corpus) | 160 / 170 (94.1%) |

The generators are measured through the code they emit, not the source text they
emit: each suite schema is generated whole, compiled, and linked in memory, so the
`$ref`'d sibling files and the embedded runtime helpers run too. `resolve-refs`
has no verdicts of its own, so it is held to semantic preservation — the resolved
document must accept exactly what the original did, judged by
`@amritk/runtime-validators` over the cases the interpreter already answers
correctly, which is the population where a resolution bug is visible and nothing
else is.

Those rates are where the packages *end up*. The suites were written first and
found real defects — a validator that accepted everything for a schema without a
`type`, `required` satisfied by an inherited `toString`, refs that emitted
uncompilable output, `$ref`-shaped data inlined as a reference — each fixed in its
own commit alongside this one. What remains is documented case by case, and each
package's README carries a "Conformance, measured" section with its number and the
reasons behind it.
