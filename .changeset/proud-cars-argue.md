---
'@amritk/generate-validators': minor
'@amritk/generate-parsers': minor
'@amritk/helpers': minor
---

Name a generated file after every part of its ref that names something.

A `$ref` was named after its last segment alone, so two definitions in different
parents — `#/$defs/user/$defs/meta` and `#/$defs/order/$defs/meta`, or a `stuff`
in each of two embedded resources — both wanted `meta.ts`, and generation refused
rather than emit a silently wrong type. An ordinary shape in a real document
stopped the build with an instruction to go and rename one of them.

The name now includes the base URI a relative ref points at and the pointer's own
definition names: `user-meta`, `second-stuff`. Only genuinely nested definitions
qualify — a segment counts when a container key (`$defs`, `definitions`,
`properties`) introduced it — so `#/components/schemas/UserProfile` is still
`user-profile` and the refs almost every document writes are unchanged.

Conformance improves as a result: `generate-validators` 1274 -> 1276 / 1281,
`generate-parsers` 1240 -> 1242 / 1281.
