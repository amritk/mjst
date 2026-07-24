---
"@amritk/mini": patch
---

Trim allocations on the hottest render paths, with no change in behaviour.

- **`jsx`** — iterate props with `for…in` instead of `Object.entries(props)`.
  Element creation is the framework's most-executed path, and `Object.entries`
  allocated an array plus a `[key, value]` tuple for every prop on every element
  built; the `for…in` walk allocates nothing. Props always arrive as a plain
  object literal from the JSX transform, so there are no inherited enumerables to
  guard against.
- **`resolveClass`** — the object (toggle-map) form now accumulates truthy keys
  in a single loop rather than chaining `entries().filter().map().join()`, which
  allocated three throwaway arrays on every reactive `class` update.
- **`applyStyle`** — the object form iterates with `for…in` for the same reason,
  dropping the per-update tuple array on every reactive `style` update.

- **`list`** — the keyed reconciler tracked which keys survived a pass with a
  freshly-allocated `Set` (plus an insert per row) on every update. A monotonic
  pass counter stamped onto each cached entry does the same job — survivor
  detection and the duplicate-key warning — without allocating anything per
  update.

Both the `./jsx-runtime` entry and the size-budgeted core move by a handful of
gzipped bytes and stay comfortably within budget.
