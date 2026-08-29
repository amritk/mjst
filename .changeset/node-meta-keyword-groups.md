---
'@amritk/runtime-validators': patch
---

Group each schema node's keywords so a node only allocates what it declares.

`NodeMeta` — the per-node keyword record the interpreter reads instead of asking
the schema for every keyword it might carry — was one flat object of 64 fields,
and the engine pays for a field whether or not the node declares it. The
overwhelmingly common node (`{ type: 'string', minLength: 1 }`) allocated 64
slots to hold two answers and 62 `undefined`s: 662 bytes, retained for the life
of the prepared validator. The AsyncAPI 3.0 meta-schema (2351 schema nodes)
carried ~1.5 MB of mostly-empty records.

The per-vocabulary keywords now live in sub-objects built only when the node
declares one of them — the string, number, array, object, reference, branching
and `unevaluated*` groups, each `null` otherwise. Averaged over that
meta-schema's nodes the record is 132 bytes (5× smaller) and the document ~300
KB. The walker was already gated on a `has…Keywords` boolean before reading any
of these fields, so the group pointer *is* that boolean and the hot path keeps
the same number of loads; steady-state throughput measured unchanged, and the
cold one-shot path got faster because a node no longer initializes 64 slots to
answer two questions (the 40-property benchmark's schema-to-first-result went
0.063 ms → 0.045 ms).

`@amritk/api`'s runtime engine and `@amritk/lint`'s `schema` rule both run this
interpreter, so both inherit the reduction.
