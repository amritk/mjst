---
"@amritk/resolve-refs": patch
---

`resolveRefs` now records an error for each external (non-`#`) `$ref` it
encounters instead of silently leaving the node unresolved. The in-memory
resolver can't load other documents, so an external ref (another file or an
http(s) URL) is kept in place and surfaced on `result.errors` with a message
pointing callers at `resolveRefsFromFile` — matching how unresolvable internal
pointers are already reported, so a half-resolved document no longer passes
without a diagnostic.
