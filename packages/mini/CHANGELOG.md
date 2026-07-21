# @amritk/mini

## 0.1.0

### Minor Changes

- 508aafe: Add `@amritk/mini` — a deliberately tiny signals-based UI layer built on `alien-signals`. Provides fine-grained reactivity (`signal`, `computed`, `effect`, `effectScope`, `batch`, `watch`, `onCleanup`), a capped set of DOM bindings that keep data off the `innerHTML` XSS surface (`bindText`, `bindAttr`, `bindClass`, `bindShow`, `bindValue`, and the single sanctioned `bindHtml` sink), keyed reactive collections (`list`) and static-template cloning (`template`), and a compilerless JSX runtime (`@amritk/mini/jsx-runtime`) whose reactivity is decided by value shape at runtime — a function-valued attribute or child is a live binding, everything else is applied once.
- 79b2383: Grow `@amritk/mini` into a layered framework via tree-shakeable subpath exports, with the `.` entry unchanged (its only runtime dependency stays `alien-signals`) and `"sideEffects": false` set so the bundle-size-sensitive widget pays zero bytes for any of them.

  - **`@amritk/mini/router`** — a client-side router in history or hash modes: `createRouter` (reactive `route` signal + `navigate` + `stop`), `matchRoute` (`/users/:id` patterns with a trailing `*` catch-all), and a `<Link>` that intercepts plain clicks while leaving modified clicks to the browser. Composition is explicit — `<Link>` takes `router.navigate` as a prop, not from a context.
  - **`@amritk/mini/flow`** — ergonomic control-flow components built on core primitives: `<Show>`, `<For>` (keyed, backed by `list`), `<Switch>`/`<Match>`, and `<Dynamic>`.
  - **`@amritk/mini/forms`** — field state (value/dirty/touched/errors as signals), submit handling, and validation that accepts either a `(values) => errors` function or a JSON Schema validated through `@amritk/runtime-validators` (eval-free/CSP-safe); inputs bind through the core `bindValue`.
  - **`@amritk/mini/query`** — a thin adapter bridging `@tanstack/query-core` observers to mini signals (caching/dedup/retry/invalidation from TanStack Query), mirroring how `solid-query` wraps query-core.

  `@amritk/runtime-validators` and `@tanstack/query-core` are optional peer dependencies, needed only by `/forms` schema validation and `/query` respectively. Two enforcement tests ship with the work: a core import-boundary walk (the `.` graph contains only `alien-signals` and no subpath leaks, and each feature stays free of the others) and a gzipped size budget on the bundled `.` entry.
