---
"@amritk/adapters": patch
---

fix: the Effect adapter now rescues nested `Schema.BigIntFromSelf` /
`Schema.DateFromSelf` instead of throwing. Previously only a top-level bigint or
runtime `Date` was mapped to an `x-mjst` hint, so a `BigIntFromSelf` /
`DateFromSelf` buried inside a struct, array, or union made `JSONSchema.make`
fail outright — unlike the Zod, Valibot, and TypeBox adapters, which handle
nested date/bigint fine. The rescue is now recursive: representable subtrees are
still converted verbatim by Effect, and only the branches leading to an
unrepresentable leaf are walked to attach `x-mjst` `primitive: 'bigint'` /
`instanceOf: 'Date'` hints at the corresponding nested paths. The documented
encoded-representation semantics for `Schema.Date` (a string) are unchanged.
