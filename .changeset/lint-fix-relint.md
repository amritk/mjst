---
"@amritk/lint": patch
---

`fixDocument` no longer lints the fixed document a second time once the fix loop has converged: the converging pass already linted that exact text, and its findings are what `remaining` reports. A document that needs no fixes is linted once instead of twice, which halves the time of the common call.
