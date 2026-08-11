---
'@amritk/helpers': patch
---

Put the schema-node-vs-name-map distinction in one place and wire every walker
to it, and add OpenAPI 3.0's `example` to the data keywords.

`SCHEMA_MAPS` had been applied at two call sites while six other walkers still
skipped `DATA_KEYWORDS` by key name alone — so a definition or property
genuinely *named* `default`, `enum`, `const` or `examples` had its whole subtree
skipped. `buildAnchorMap` never registered an anchor declared inside a
`$defs.default`, leaving `$ref: '#thing'` unresolvable; `buildResourceRegistry`
never registered a `$id` under `$defs.examples`. `schemaChildren` now yields
each child with the position it sits in, and `buildAnchorMap`,
`buildDynamicRefMap`, `buildResourceRegistry`, `assertIdScopes` and
`normalizeRefScopes` all walk through it.

`example` joins `DATA_KEYWORDS`: it is OpenAPI 3.0's singular spelling,
`foldNullable` runs specifically on 3.0 documents, and the runtime validators'
own copy of the set already had it — so an `example` value was being walked as
though it were a schema.
