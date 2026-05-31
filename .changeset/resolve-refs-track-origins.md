---
"@amritk/resolve-refs": minor
---

Add an opt-in `trackOrigins` option to `resolveRefs` and `resolveRefsFromFile`.

When set, the result carries an `origins` map: for every object/array inlined in
place of a `$ref`, it records the document (`location`) and in-file path
(`pointer`) it was defined at. Because the resolver shares one object per repeated
`$ref` target, a consumer can map any node in the resolved tree back to its source
with a single identity lookup — no need to re-walk the `$ref` chain across the
unresolved documents. First-write-wins, so a node reached through a chained ref
keeps its definition origin rather than an intermediate pointer. Also exports the
`pointerToPath` helper and the `Origin` / `OriginMap` / `ResolveRefsOptions` types.
The option defaults to `false`, so existing callers are unaffected.
