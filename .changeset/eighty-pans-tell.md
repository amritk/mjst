---
'@amritk/generate-examples': patch
---

Degenerate keywords no longer produce an arbitrary that throws at import.

- An empty `oneOf`, `anyOf`, `enum`, or `type: []` emitted `fc.oneof()` /
  `fc.constantFrom()` with no arguments, and both throw. They now degrade to
  `fc.anything()`, as every other keyword this generator cannot honour does. A
  single-branch choice is emitted directly instead of being wrapped.
- A fractional or negative length/count bound (`minItems: 1.5`,
  `maxLength: -5`) was passed straight to fast-check, which requires a
  non-negative integer and throws otherwise. Each bound now rounds toward the
  satisfiable side and floors at zero.
