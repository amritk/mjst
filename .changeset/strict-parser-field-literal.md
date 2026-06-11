---
"@amritk/generate-parsers": patch
---

perf(generate-parsers): build the strict fast-path result as a declared-key field literal instead of `{ ...input }`

When a strict (or `additionalProperties: false`) parser's deep guard fires, it
has already proven the input's keys are exactly the declared properties (the
`_hasOnlyKnownKeys` term). The fast path now returns an explicit field literal of
those keys rather than spreading the input. The result is identical — same keys,
same shared values — but a fixed-shape literal is materially faster than a generic
spread, yields a stable hidden class, and matches the slow path's declared key
order. Coerce parsers that intentionally keep undeclared keys still spread.
