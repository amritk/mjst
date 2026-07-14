---
'@amritk/lint': minor
'@amritk/mjst': minor
---

Surface `$ref` resolution failures as lint findings. `mjst lint` previously
discarded the resolver's `errors` array, so a typo'd `$ref`, a missing file, or
a refused/failed remote fetch produced no diagnostic at all. A `LintResolver`
may now return `diagnostics`, and the CLI resolver maps each resolution error to
a finding — anchored to the offending ref's position in the source document
where recoverable, or reported at document level otherwise.
