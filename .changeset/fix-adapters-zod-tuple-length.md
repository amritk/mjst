---
"@amritk/adapters": patch
---

Enforce tuple length in the Zod adapter. Zod 4's `toJSONSchema` emits a fixed
tuple as a bare `prefixItems` array with no length bound, so the converted schema
accepted arrays that were too short (trailing positions went unchecked) or too
long (nothing forbade extra items) — values the Zod schema itself rejects. The
adapter now restores the constraint: `minItems` requires the fixed elements, and
a tuple with no `.rest(...)` gets `items: false` to forbid extras. Tuples with a
rest element keep their open tail. Applied to every `prefixItems` node, so nested
tuples are fixed too.
