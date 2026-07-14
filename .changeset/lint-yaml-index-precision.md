---
'@amritk/lint': patch
---

Close two precision gaps in the YAML position index. Complex (map/seq) mapping
keys no longer collapse to `''` and collide in the index — each gets a canonical
structural serialization, so distinct complex keys resolve to distinct source
ranges instead of clobbering one another. Subtrees reachable only through a
`*alias` or a `<<` merge are now indexed too: paths reached through an alias
resolve to the anchored node, and merged keys resolve to their source location
(with explicit keys still winning), rather than falling back to the nearest
ancestor.
