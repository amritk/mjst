---
---

Add tests covering the allocation-free happy-path guard in generated object
validators: that the guard is emitted (and uses the exact key-count form under
`additionalProperties: false`) for all-required bare-typed and nested objects,
that valid input returns `true` while invalid input falls through to the
unchanged error-collecting path, and that the guard is omitted for optional
properties, constrained properties, and object-level keywords it cannot prove
cheaply.
