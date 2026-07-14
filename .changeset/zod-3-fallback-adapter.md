---
"@amritk/adapters": minor
---

Add a Zod 3 fallback to the Zod adapter. When the installed `zod` lacks the
native `toJSONSchema` (Zod 3), the adapter now routes conversion through the
optional `zod-to-json-schema` peer dependency, applying the same `x-mjst`
date/bigint mapping and lossy-type warnings as the Zod 4 path. If neither Zod 4's
`toJSONSchema` nor `zod-to-json-schema` is available, a clear error explains what
to install.
