---
"@amritk/resolve-refs": patch
---

Percent-decode URI-encoded segments in `getByPointer` before applying `~1`/`~0` unescaping, so keys like `{volume_id}` encoded as `%7Bvolume_id%7D` resolve correctly and `%2F` within a segment is never treated as a path separator.
