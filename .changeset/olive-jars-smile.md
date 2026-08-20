---
'@amritk/helpers': minor
---

`unknownKeyCheck`'s `isUnknown` / `isKnown` now return self-parenthesized
expressions, matching what `multiple-of-check` and `string-length-check`
already promise.

The two forms were not interchangeable: above `INLINE_KEY_LIMIT` the result is
an atomic `set.has(k)`, below it a bare `a || b`. A caller writing
`x && check.isKnown(k)` therefore got `(x && a) || b` for a 16-key object and
correct code for a 17-key one — a precedence bug that appears and disappears
with a performance threshold rather than with anything the caller wrote.
Generated sweeps gain one pair of parentheses; nothing they mean changes.
