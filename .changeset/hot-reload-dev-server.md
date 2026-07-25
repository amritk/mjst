---
'@amritk/api': minor
---

Add hot reloading for the development server through a new `@amritk/api/dev`
entry: `createHotApi`, `watchPaths`, and `importFresh`. The dev server keeps its
socket, its connections, and everything living outside your route modules while
the route table, validators, and OpenAPI document are rebuilt from disk on every
save — no restart, no in-memory state lost between edits.

`createHotApi({ load, watch })` returns a normal `Api`, so it is handed to
`toFetchHandler` / `toNodeHandler` once and never mentioned again; the build
underneath it is swapped atomically, and in-flight requests finish against the
build they started on. A broken edit does not take the server down — the previous
build keeps serving, with the reason logged and kept on `api.error()` — and a
failure before the *first* build still binds the port, answering
`503 {error:'not_loaded'}` with the error instead of exiting. Reloads that arrive
mid-build coalesce into one follow-up pass, so a branch switch costs one extra
build rather than one per file. `reload(changed?)`, `close()`, and `generation()`
round out the surface.

`watchPaths(paths, options?)` is the debounced filesystem watcher (recursive,
`node_modules`/`dist`/dotfile-aware, extension-filtered), and it is only the
default implementation of the `watch` seam — anything shaped
`(onChange) => dispose` fits, including a bundler's watcher or a test's manual
trigger. `importFresh(specifier, options?)` is the module re-import that lets
`load` see new code: on Node 22.15+ it re-evaluates the **whole local graph**
(a `node:module` resolve hook scoped to `root`, so dependencies are never
re-evaluated), and elsewhere the named module.

The entry is development-only and one-way — it imports the runtime, never the
reverse — so `node:fs` watching and module re-importing stay out of the graph
that ships to Workers and browsers.
