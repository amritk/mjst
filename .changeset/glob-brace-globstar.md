---
'@amritk/lint': patch
---

A `**` inside a brace alternation collapses the slash that follows the group
again.

`**` only becomes `(?:.*/)?` when it can see the `/` after it, and compiling
each alternative in isolation hid that slash — so `{**,dist}/x.yaml` produced
`(?:.*|dist)/x\.yaml`, which demands a slash and no longer matched a root-level
`x.yaml`. The brace *expansion* this replaced (for being exponential in the
number of groups) did match it. A `/` immediately after a group is now folded
into each alternative, so `**/` collapses while `dist/` keeps its literal slash.
