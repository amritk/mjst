---
"@amritk/resolve-refs": minor
---

Add opt-in origin tracking to `resolveRefsFromFile`.

Pass `trackOrigins: true` and the result includes an `origins` map
(`WeakMap<object, NodeOrigin>`) that records, for each inlined object/array,
which document it came from and its path within that document. A node carries
the origin of the innermost `$ref` that produced it, so a chain
`a.yaml#/x → b.yaml#/y` attributes the node to `b.yaml`. This lets consumers
(e.g. a linter) report a finding at the file and line the content actually
lives in, rather than at the `$ref` site that pulled it in. Tracking is off by
default, so the common path stays allocation-free.

Also exports `pointerToPath`, the RFC 6901 pointer parser shared with
`getByPointer`.
