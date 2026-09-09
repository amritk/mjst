---
'@amritk/generate-validators': minor
'@amritk/mjst': minor
---

Let generated validators enforce `format`.

The generator treated `format` as an annotation with no way to say otherwise,
while the interpreter run as `@amritk/api` runs it enforces them — so swapping
build-time validators into an API built on runtime ones silently loosened it.
`buildValidatorSchema` and the CLI's `--formats` now take `'all'` or a list, and
generated code checks exactly those, in `validateX` and in the flat `isX` alike.
Off by default: `format` stays an annotation, which is 2020-12's own reading.

The checks are emitted into a `formats.ts` beside the validators — only the ones
the schema names — because generated output is dependency-free and cannot import
the interpreter's table. The two implementations are run against each other over
the official suite's whole optional/format corpus and required to agree on every
case.
