---
"@amritk/resolve-refs": minor
"@amritk/mjst": minor
---

Resolve `$ref`, `$dynamicRef`/`$dynamicAnchor`, and `$recursiveRef`/`$recursiveAnchor` when linting.

`@amritk/resolve-refs` now dereferences plain-name anchors (`#node` → `$anchor`/`$dynamicAnchor`) and the dynamic/recursive reference keywords, in both the in-memory and cross-file resolvers. Dynamic/recursive references bind to their document-global anchor (the single-bundle case; nested `$id` base-URI re-scoping is not modelled).

`mjst lint` now dereferences documents before running rules, so rules with `resolved: true` (the ruleset default) see through references — including cross-file refs, whose findings are attributed to the referenced file's own `line:column`. New flags: `--no-resolve` to disable, and `--resolve-remote` / `--allowed-hosts` / `--allow-private-hosts` to opt into fetching remote (`http(s)`) refs (off by default so a lint run stays offline).
