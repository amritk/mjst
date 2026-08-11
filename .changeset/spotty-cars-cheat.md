---
'@amritk/helpers': patch
---

Route `foldNullable` and `normalizeRefScopes` through the shared
`schemaChildren` instead of restating the schema-node-versus-name-map rule.
Both had grown their own spelling of it — one with a `SCHEMA_MAPS.has(key)`
branch, one with an `EMPTY` sentinel swapped in per position — which is the
drift that put the rule in a shared place to begin with.
