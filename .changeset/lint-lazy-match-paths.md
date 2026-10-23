---
'@amritk/lint': minor
---

Lint runs build a match's path only when it becomes a finding or its rule function reads `context.path`, instead of for every JSONPath match. Findings are unchanged, and the public `query`, `queryCompiled` and `queryMany` return the same matches as before.

**Breaking for custom rule functions:** `context.path` is now a getter inherited from the context's prototype, not an own property. Reading it, destructuring it and copying the context with `{ ...context, path }` work as before. A copy made with `{ ...context }` that does not set `path` has `path: undefined`, and `Object.keys(context)` no longer lists `path`. Assigning `context.path` still works: it gives that context an own, writable, enumerable `path`, and it changes only what the function reads back, never where the finding lands.
