---
'@amritk/lint': patch
---

Collect the own-property read and the `__proto__`-safe write into one
`core/own-key` module instead of three copies, and drop the raw NUL byte from
the cache-key template literal in `ruleset.ts`.

The NUL was written as a literal control character rather than `\0`, which made
git classify the whole file as binary — so its changes showed as "Binary file
not shown" in every diff and could not be reviewed without `--text`. The escape
sequence, which `index.ts` already uses for the same purpose, is byte-identical
and leaves the file readable.
