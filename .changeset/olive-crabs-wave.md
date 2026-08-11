---
'@amritk/lint': patch
---

Fix the second prototype-chain membership test in `oasPathParam`. The duplicate
check was corrected to use `Object.hasOwn`, but the "every `{template}` must
have a matching definition" check still used `in` — so a path template named
`{constructor}`, `{toString}` or `{valueOf}` read as already defined and its
missing parameter went unreported.
