---
"@amritk/mini": patch
---

Trim allocations on the JSX runtime's hottest paths, with no change in
behaviour.

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

The size-budgeted core entry is untouched; the `./jsx-runtime` entry moves by a
handful of gzipped bytes.
