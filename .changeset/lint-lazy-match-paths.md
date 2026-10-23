---
'@amritk/lint': minor
---

Lint runs build a match's path only when it becomes a finding or its rule function reads `context.path`, instead of for every JSONPath match. Findings are unchanged, and the public `query`, `queryCompiled` and `queryMany` return the same matches as before.

**Breaking for custom rule functions:** a rule function's context now inherits `path` as a getter from a shared prototype instead of carrying it as an own property. Reading `context.path`, destructuring it, `'path' in context`, `for...in` and copying with `{ ...context, path }` behave as before. What differs:

- `{ ...context }` and `Object.assign({}, context)` copies that do not set `path` have `path: undefined`.
- `Object.keys`, `Object.entries`, `JSON.stringify` and `Object.hasOwn(context, 'path')` no longer see `path`, and `Object.getOwnPropertyDescriptor(context, 'path')` is `undefined`.
- The context's prototype is no longer `Object.prototype`.
- The context carries one own symbol-keyed property holding the runner's internal target. `Reflect.ownKeys` and `Object.getOwnPropertySymbols` list it, and spread copies it; `Object.keys`, `JSON.stringify` and `for...in` skip it.
- Assigning `context.path` still works: it gives that context an own, writable, enumerable `path`, from then on visible to all of the above. It changes only what the function reads back, never where the finding lands, and never another context.
