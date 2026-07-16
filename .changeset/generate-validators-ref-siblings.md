---
"@amritk/generate-validators": patch
---

Apply 2020-12 sibling keywords alongside a property `$ref`. A property schema like `{ $ref: '#/$defs/str', minLength: 5 }` previously validated only the referenced schema and ignored the sibling constraint, so a too-short string passed. The generated validator now runs the referenced validator **and** the sibling constraint/combinator checks; a bare `{ $ref }` is unchanged. (Scoped to named properties; the dynamic-key value path — `patternProperties`/`propertyNames`/`additionalProperties` values — is unchanged for now.)
