---
'@amritk/validation': minor
'@amritk/generate-validators': patch
'@amritk/generate-parsers': patch
'@amritk/adapters': patch
'@amritk/mjst': patch
---

Rename `@amritk/parsers` to `@amritk/validation`.

The package composes two engines and reaches seven modes — `types`, `guard`,
`validate`, `check`, `coerce`, `repair`, `parse` — and `parsers` named the one of
them its dominant engine cannot express. Six of the seven come from the validator
engine; the parser engine supplies `parse` alone, and the package's own default
(`['types', 'guard', 'validate']`) emits no parser at all, so the name described
a mode that is absent from a default build.

Nothing moves but the name. No export, option, mode or emitted byte changes, and
`@amritk/parsers` never reached npm — the release that would have published it
failed on that package alone, so there is no deprecation to follow and no
version of it for anyone to be holding.
