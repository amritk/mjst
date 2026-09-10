---
'@amritk/mjst': patch
---

Say in each generated channel contract that headers were not projected.

`--message-contracts` writes payloads only: an `@amritk/api` contract describes
WebSocket frames, which carry no headers of their own. A message's `headers`
schema still gets its own generated tree, so a module for a channel that
declares any now names those messages and points at `<message>-headers/` rather
than leaving the omission to be discovered.
