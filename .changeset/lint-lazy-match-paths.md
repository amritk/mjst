---
'@amritk/lint': patch
---

Lint runs build a match's path only when it becomes a finding or its rule function reads `context.path`, instead of for every JSONPath match. Findings are unchanged; the public `query`, `queryCompiled` and `queryMany` return the same matches as before.
