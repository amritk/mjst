---
"@amritk/api": patch
---

Match dynamic routes faster in the runtime engine. The request path is split with an `indexOf` walk instead of `split('/')`, and coerced path parameters are copied without allocating an entry array per parameter. Routes with path parameters handle 10–30% more requests per second.
