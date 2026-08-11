---
'@amritk/generate-parsers': patch
---

Collect tuple `$ref`s from the root, and in both spellings.

The `prefixItems` walk lived only inside the recursive helper, but the root
enumerates its keywords by hand — so a schema that *is* a tuple emitted a type
naming `Contact` with no import for it at all, which is the TS2304 the walk was
added to close. Draft-07's array-valued `items` is the same tuple, and it was
routed through the single-schema `items` branch instead: it got a value import
whose `parseContact`/`validateContactShape` nothing calls, the `noUnusedLocals`
error the type-only flag exists to prevent. Both spellings are now walked as
tuple positions, at the root and below it, and the single-schema `items` form
still gets its value import.
