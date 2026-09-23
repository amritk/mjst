---
"@amritk/api": patch
---

`fetchToNodeHandler` accepts a `Host` header with an empty port (`example.com:`), which RFC 3986 allows, instead of replacing it with `localhost`.
