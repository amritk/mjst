---
---

Tooling: stop `@amritk/mini` from being force-major-bumped whenever an internal
peer dependency (`@amritk/runtime-validators`) is released. mini declared the
peer as `workspace:*`, which republishes as the exact version, so every bump
looked out-of-range; changesets also majors peer dependents regardless of range
by default. The peer range is widened to `>=0.8.0` and
`onlyUpdatePeerDependentsWhenOutOfRange` is enabled so mini only majors when the
peer genuinely leaves its range. Empty changeset: no version bump intended.
