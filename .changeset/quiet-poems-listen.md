---
---

Add `docs/api-realtime-plan.md` — design plan for contract-derived realtime
updates in `@amritk/api`

Documentation only; no published package changes. Records the architecture for
server-pushed updates that derive topics, cache keys, payload schemas, and
subscription authorization from the existing route contracts, with invalidation
as the correctness floor and payload push as a fast path that degrades into it.
