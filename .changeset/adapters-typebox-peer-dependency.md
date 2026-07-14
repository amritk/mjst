---
"@amritk/adapters": patch
---

Declare `@sinclair/typebox` as an optional peer dependency (`>=0.34`).

The TypeBox pass-through adapter (`typebox-to-json-schema`) relied on TypeBox's
plain-object schema shape but had no `peerDependencies` entry, so there was no
version signal or guard for it. Adding the optional peer (mirroring the
`peerDependenciesMeta` pattern already used for zod, valibot,
`@valibot/to-json-schema`, and effect) records the supported range and lets
package managers surface an incompatible TypeBox version instead of failing
silently on a future shape change.
