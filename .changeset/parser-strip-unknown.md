---
"@amritk/generate-parsers": minor
"@amritk/mjst": patch
---

Add a `stripUnknown` option to `@amritk/generate-parsers` (a `buildSchema` /
`generateFile` / `generateParserFunction` option, the `stripUnknown` config key,
and the `--strip-unknown` CLI flag; default `false`). When enabled, generated
parsers build their result from the schema's declared properties only, silently
dropping undeclared input keys at every nesting level — zod's `.strip()` / the
`parseSafe` benchmark semantics — without treating extras as a validation error.
It reuses the existing strict-keys machinery: the `{ ...input }` spread is dropped
in the slow path and the fast path is gated on the `_hasOnlyKnownKeys` predicate.
It composes with `strict` (still throws on wrong types and missing required
properties, but strips extras instead of throwing on them) and yields to
`additionalProperties: false`, where rejecting still wins over stripping in strict
mode.
