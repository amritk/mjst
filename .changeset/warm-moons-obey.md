---
'@amritk/resolve-refs': patch
---

Rebase the third kept-reference site. `keepUnresolved` and the depth-limit walk
both re-express a relative `$ref` against the root document; the
scope-sensitive branch — which keeps a reference whose `$dynamicAnchor` binding
inlining would change — re-emitted it verbatim, so `./c.json` kept out of
`sub/b.json` named the root's own `c.json` once it sat in the root output.
