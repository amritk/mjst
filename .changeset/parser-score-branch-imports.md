---
"@amritk/validation": patch
---

Restore the well-typed scoring term for a `$ref` property of a `$ref` union branch. The previous fix for the missing import dropped the term, so two branches carrying the same keys could tie and the coercing parser repaired toward the wrong one (`{ x: { name } }` became `{ x: "[object Object]" }`). The import collector now reads through `$ref` union branches the way the scorer does and imports the shape validators it calls.
