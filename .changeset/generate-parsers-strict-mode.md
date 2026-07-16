---
"@amritk/generate-parsers": patch
---

Close two cases where a strict-mode parser silently coerced input instead of throwing (strict mode is documented to reject any violation):

- **Root scalar constraints.** A root (non-object) scalar parser asserted only the `typeof`, so `{ type: 'string', minLength: 5 }`, `{ type: 'number', minimum: 10 }`, `pattern`, `multipleOf`, a typed or type-less `enum`, and `const` all passed through unvalidated. Root scalars now assert their full constraint set (and a type-less `enum`/`const` root asserts membership).
- **Typed records.** `{ type: 'object', additionalProperties: { type: 'number' } }` in strict mode wrapped the *coercing* value parser, so `{ a: 'x' }` became `{ a: 0 }`. Strict record values now throw on the wrong type (and integer values enforce integrality); coerce mode still repairs as before.
