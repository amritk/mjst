---
'@amritk/adapters': patch
---

Route the tuple walk through `@amritk/helpers`' `schemaChildren` rather than a
local copy of the schema-node-versus-name-map rule, so it cannot drift from the
walkers that share it.
