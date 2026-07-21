---
"@amritk/mini": minor
---

Round out `@amritk/mini` after a deep review, closing gaps without changing the charter:

- **`mount(container, component)`** — the application root that was missing: it runs a component inside an owning `effectScope`, appends the node, and returns a `dispose` that removes the node and tears the scope down. Top-level `onCleanup` and bindings now have an owner (previously they leaked because a raw `appendChild(App())` opened no scope).
- **`<For>` is O(n) again** — the core `list` now hands `key`/`create` the running index, so `For` no longer recovers it with an O(n) `each().indexOf(item)` per item (which also mis-keyed duplicate primitives).
- **SVG works** — the JSX runtime creates SVG tags with `createElementNS`, so `<svg>`/`<path>`/… render instead of becoming inert HTML-namespaced elements. Common SVG element and attribute types are included.
- **`class` and `style` objects** — `class` accepts a string, an array (falsy entries dropped), or a `{ name: boolean }` toggle map; `style` accepts a cssText string or a property object (camelCase keys kebab-cased). Both stay static-or-reactive. `<select>`/`<option>`/`<form>` attributes are now typed.
- **`/query` reactive options** — `createQuery` accepts an options getter, so the query key can depend on signals (`() => ({ queryKey: ['user', id()] })`) and refetches when they change. `refetch()` now returns its promise.
- **Non-string form fields** — `createForm` field values may be `string | number | boolean`; `bind` wires `.checked` for checkbox/radio and a coerced number for number/range inputs, and cleans up its value binding and blur listener with the enclosing scope. New core `bindChecked`. `bindValue` now holds writes during IME composition and commits on `compositionend`.
- **Router** — `RouteState` gains a parsed `query` record, and a new `<RouterView>` renders the matched route's view and swaps it on navigation (removing the manual cast).
- **`watch`** — accepts `{ immediate: true }` to also run once on setup.
