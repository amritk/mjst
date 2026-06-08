---
---

Add benchmark harnesses for `$ref` resolution. `@amritk/resolve-refs` gains a
`bench` script comparing the single-pass memoized resolver against a naive
re-resolving baseline (reuse-heavy, chained, wide-distinct, and cyclic
schemas), and `@amritk/runtime-validators` gains a `bench:dynamic` script
comparing the build-time `$dynamicRef` rewrite (`@amritk/helpers`) against the
interpreter's runtime depth-first anchor search, cold and memoized. Tooling
only — no shipped code changes.
