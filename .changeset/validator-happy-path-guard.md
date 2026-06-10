---
'@amritk/generate-validators': minor
---

Generated object validators now run an allocation-free boolean guard on the
happy path. For all-required objects of bare-typed properties (and likewise
nested objects), the validator first evaluates a single `&&` chain of `typeof`
checks — with an `Object.keys().length === N` count standing in for the
unknown-key sweep when the object is closed with `additionalProperties: false` —
and returns `true` immediately when it passes. Only when the guard fails does
execution fall through to the existing error-collecting body, so invalid input
still gets full JSON-Pointer errors and every verdict is unchanged. The guard is
emitted only when it can prove validity cheaply; schemas with constraints it
can't express (patterns, ranges, enums, `$ref`, arrays, optional or extra-keyed
objects) keep their previous output. On the
`moltar/typescript-runtime-type-benchmarks` shape this moves valid-input
throughput past TypeBox's compiled checker both with and without
`additionalProperties: false`.
