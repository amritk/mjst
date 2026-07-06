---
'@amritk/mjst': minor
'@amritk/helpers': minor
'@amritk/generate-parsers': minor
---

Derive the root type name from the schema instead of always using `Document`
(breaking).

The root type is now named after the schema — its `title`, falling back to the
schema filename in PascalCase (`program.json` → `Program`, `spec-plan.json` →
`SpecPlan`), and only then to `Document`. Generating from two schemas no longer
forces import aliasing: the functions become `parseProgram` /
`validateProgramShape` and nested types `SpecPlan_AxiomsItem`. A new
`--root-type <Name>` flag overrides the name for a single `--schema` run; it is
rejected with `--schema-dir`, where each schema derives its own root.

This is breaking for consumers importing `parseDocument` / `validateDocumentShape`
today — update those imports to the new schema-derived names.

Fixed a latent generator bug this surfaced: a JSON Schema meta-schema special
case (a pass-through, validation-free parser) fired on any type literally named
`Schema`. It now applies only to `$ref`-reached definitions, so a common
`schema.json` root gets a real parser instead of a silent pass-through.
