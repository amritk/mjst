---
'@amritk/runtime-validators': minor
---

Add `@amritk/runtime-validators/compile` — an opt-in compiled tier for the case
an interpreter is worst at.

`compileGuard(schema)` returns the same boolean guard `validateGuard` does, but
builds it by partially evaluating the schema into a **tree of closures** once, up
front: regexes compiled, property lists flattened, bounds and divisor cases
specialized, `$ref`s resolved and linked. Validation is then a tree of direct
calls with no schema inspection left in it. It stays eval-free — closures, not
`new Function` — so a strict CSP, Workers and Hermes are unaffected.

It is deliberately **not** the default. Measured on the benchmark shapes it is
1.45–2.8× the interpreter in steady state, and on the cold one-shot path this
package is built around it is a cost rather than a saving (~2.5× the
interpreter's cold time on a wide schema, though a `$ref`-heavy one comes out
ahead). Making it the default would spend the cold-start advantage that is the
whole reason to interpret a schema rather than compile it. Run
`bun run bench:compile` for the numbers on your own hardware.

Correctness comes from deferral rather than from a second implementation of JSON
Schema. A node carrying a keyword the compiler does not answer itself —
`if`/`then`/`else`, `unevaluated*`, `patternProperties`, `propertyNames`,
`contains`, `dependent*`, `format`, `uniqueItems` — is handed to the interpreter
whole, subtree included, and a document containing `$dynamicRef` /
`$recursiveRef` (which resolve against a dynamic scope only a live walk has) or
validated against a `schemas` registry is not compiled at all. A document
declaring `$id` *is* compiled, with every `$ref` linked through the same resource
registry the walker builds. `compile-parity.test.ts` holds the compiled guard to
the interpreter's verdict across the entire JSON Schema Test Suite, with roughly
half the cases proven to take the compiled path rather than the fallback.
