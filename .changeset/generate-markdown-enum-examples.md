---
'@amritk/generate-markdown': minor
---

Surface `enum` and `examples` in the generated property table. Each property's
full-width detail row now appends an **Allowed:** line for `enum` values and an
**Examples:** line for `examples`, formatted (quoted/JSON-encoded) the same way
defaults are. The README gains an Examples section showing input schemas and
their generated markdown for defaults, enums/examples, required properties, CLI
flags, and nested objects.
