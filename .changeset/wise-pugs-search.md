---
'@amritk/resolve-refs': patch
---

Give the depth-limit rebase a visited set, and point bare-fragment refs back at
the document that wrote them.

`detach` preserves cycles and shared subtrees deliberately — a YAML recursive
anchor is one — and the rebase walk had no guard for either. A cyclic document
always trips the depth limit, which is the only way into that walk, so a cyclic
document reached from a non-root file made `resolveRefsFromFile` spin forever
instead of returning. A subtree reached from two parents had its refs rebased
twice, turning `./c.json` into `./sub/sub/c.json`.

A ref with no file part was returned untouched on the grounds that it "already
means the same thing in both documents". It does not: `#/$defs/Thing` names a
place inside *its own* document, and once the node is lifted into the root
output it reads against the root's `$defs` — a different definition that may
well exist and resolve cleanly, which is the failure shape this function exists
to prevent. Such a ref is now written against the document it came from.
