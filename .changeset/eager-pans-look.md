---
'@amritk/runtime-validators': minor
---

Refuse a `pattern` that does not compile when the validator is built.

`pattern: "("` surfaced as a bare `SyntaxError` thrown out of the validator the
first time a value happened to reach that node, so a broken pattern under a
rarely-taken branch worked until one day it did not. The build-time walk that
already screens every pattern for catastrophic backtracking now compiles it too,
covering the patterns nothing reaches and naming the problem where it can be
understood. A 50-pattern schema still goes from schema to first result in 0.13 ms.
