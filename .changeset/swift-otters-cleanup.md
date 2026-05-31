---
"@amritk/helpers": patch
---

Remove an unreachable enum branch in `generateTypeDefinition` and collapse the
single/multi-value enum cases into one `map(...).join(' | ')`. No behavior
change — purely an internal simplification.
