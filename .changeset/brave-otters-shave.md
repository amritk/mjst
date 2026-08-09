---
"@amritk/mjst": patch
"@amritk/resolve-refs": patch
---

Retry the publish that npm has refused since 0.14.0 and 0.5.0.

Every version of these two since 2026-08-04 has been built, tested and packed by
the release job and then refused by the registry with an empty 403, while the
other ten packages publish from the same run. Nothing in either package changed
here — the bump gives the release a version to attempt while the block is with
npm support.
