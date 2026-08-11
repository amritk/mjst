---
'@amritk/generate-examples': patch
---

Do not let an uncompilable `pattern` end the run. `deriveExample` compiled
`schema.pattern` unguarded to check a sampled candidate, so a schema carrying a
`pattern` that is not a valid JavaScript regex (`*bad`, `a{2,1}`, a duplicate
named group) threw a bare `SyntaxError` out of the generator. It now treats an
uncompilable pattern as unsatisfied and emits the fallback string — the same
choice the `patternProperties` compile in the same file already made — leaving
the invalid schema to be reported where invalid schemas are reported.
