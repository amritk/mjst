---
'@amritk/resolve-refs': patch
---

Give the depth-limit rebase the role walk the resolver uses, so it only touches
real references. Walking the truncated subtree structurally rewrote `$ref`
strings sitting in `enum`, `const`, `default` and `examples` — instance values
that merely have a property spelled `$ref`, the case the official suite files
under "naive replacement of `$ref` with its destination is not correct" — so
the schema came back accepting a different literal than the author wrote. It
now starts from the role the truncated node actually has and follows
`childRole` from there, leaving data positions alone while still rebasing the
references beside them. The unreachable `?? name` fallback in the hoist attach
is gone with it.
