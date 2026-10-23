---
'@amritk/lint': patch
---

Lint runs build a match's path only when it becomes a finding or its rule function reads `context.path`, instead of for every JSONPath match. Findings are unchanged; the public `query`, `queryCompiled` and `queryMany` return the same matches as before.

A rule function's `context.path` is now a getter inherited from the context's prototype, not an own property. Reading it, destructuring it or overriding it in a copy (`{ ...context, path }`) works as before. A function that copies the context with `{ ...context }` and reads `path` from the copy without setting it gets `undefined`, and `Object.keys(context)` no longer lists `path`.
