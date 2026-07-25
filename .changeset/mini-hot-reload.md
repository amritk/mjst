---
'@amritk/mini': minor
---

Add hot reloading: `@amritk/mini/hot` (`hotMount`) plus `acceptHotUpdates()` on `@amritk/mini/vite`. Together they turn the dev server's full page reload into a tree swap.

A mini app had no hot-update boundary: nothing in it accepts an HMR update, so an edit to any component walked up the import graph, found no acceptor, and reloaded the page.

- **`hotMount(container, App, import.meta.hot)`** hands the runtime the mount's `dispose` as the module's teardown, so the old tree is removed and every effect and `onCleanup` fires before the updated entry mounts the new one.
- **`acceptHotUpdates()`** appends `import.meta.hot?.accept()` to the module that mounts, which is what actually makes it the boundary — Vite decides that by reading the module's source for `import.meta.hot.accept(`, and a runtime accept reached through a helper is invisible to that scan. It applies during `serve` only and skips modules that already accept on their own.
- **The same call site works in a production build.** `import.meta.hot` is `undefined` there and `hotMount` is exactly `mount`, so no `if (import.meta.hot)` at the entry.
- **It is a subpath, not an option on `mount`.** The `.` entry is byte-budgeted for the embed widget, which ships one static bundle and has no dev server to hot-update, so it pays nothing for this.

Signal state resets on each reload — mini has no compiler and no component identity, so there is nothing to map an old component's signals onto in the new one; state that should survive edits belongs in a separate store module, which keeps its instance because it is not the module that changed.
