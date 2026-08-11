---
'@amritk/api': patch
---

Keep `>` as a regex-preceding character in the contract scan. Only `<` was
implicated in the JSX case (`</p>`); `>` is the second half of `=>`, and
`=> /re/.test(x)` is ordinary code. Dropping it read that `/` as division, so a
quote inside the regex body opened a string scan that ran past the next
`defineContract` — trading the JSX bug for an arrow-function one, with the same
silent outcome.
