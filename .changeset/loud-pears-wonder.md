---
'@amritk/resolve-refs': patch
---

Rebase the refs inside a subtree the depth limit handed back whole. Past
`maxDepth` the branch is returned as-is rather than unwinding the stack, but it
is still being lifted into a root-based output — so a relative `./c.json`
written in `sub/b.json` came to name the root's own `c.json`, a different file
that exists and resolves cleanly. Only the kept-reference path had been
rebased; the truncated-subtree path now gets the same treatment.
