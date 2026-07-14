---
"@amritk/generate-examples": patch
---

Emit lazy references for cross-file `$ref` cycles so mutually recursive schemas
no longer crash on import.

Previously only direct self-references were tied lazily (via `fc.letrec`). A
mutual cycle spanning files (`a → b → a`) emitted eager top-level references
between the generated modules, which threw a circular-ESM TDZ `ReferenceError`
the moment the arbitraries were imported. The builder now detects strongly
connected components in the ref graph and defers references between cycle
members (`fc.constant(null).chain(() => OtherArbitrary)`), breaking the import
cycle while leaving non-cycle references eager.
