---
'@amritk/runtime-validators': patch
'@amritk/helpers': patch
---

Specialize each schema node into a closure on first visit, instead of re-walking
the schema on every call.

The interpreter rediscovered the same things for every value it validated: which
keywords a node carried (a `WeakMap` lookup per node), its property key list, its
`required` membership, its compiled `pattern`s, and which of the type-specific
keyword blocks could possibly do work. None of that depends on the value — it is
a pure function of the schema node — so a CPU profile of the steady-state
benchmark spent essentially all of its time in dispatch rather than in checks.

Now a node is turned into a step closure the first time a validation reaches it,
with all of that already resolved and closed over, and the node's record is
patched so later calls go straight to it. Validating is then nested closure
calls with the traversal, the keyword dispatch and the metadata lookups gone.
Steady-state throughput is up **39–143%** across the bench suite (the biggest win
on the `moltar/typescript-runtime-type-benchmarks` shape now in `bench/`, where
guard throughput more than doubles), and the `@amritk/api` request path gains
5–11% where validation is on the critical path.

This is still an eval-free interpreter — no `new Function`, no code generation,
no build step — so it runs unchanged under a strict CSP, on Cloudflare Workers,
and on React Native/Hermes. The specialized form is a tree of ordinary closures.
Closing the rest of the gap to generated code is not something closures can do:
what makes `@amritk/generate-validators` fast is a single inlined function body,
and an indirect call per node is the floor for anything that does not emit one.

Nothing observable changes. Error messages, JSON Pointer paths, the `maxSteps` /
`maxDepth` accounting, the ReDoS pattern screen, and `$ref` / `$dynamicRef` /
`$recursiveRef` resolution — including the dynamic scope, which stays a runtime
parameter because that is exactly what `$dynamicRef` late-binds against — are all
preserved as they were. The full JSON Schema Test Suite and the Ajv differential
fuzz stay green.

Building is deferred to a node's first visit rather than done up front, so
`validate(schema)` still returns without reading the schema, an unresolvable
`$ref` still throws on use rather than on construction, and a one-shot check
never pays for `$defs` its data does not reach. Cold cost does move, because a
node's step is a few closures where its metadata was one object: a `$ref`-heavy
schema gets ~10–15% *faster* cold (targets are specialized once and reused across
array elements), a small schema is within noise, and the 40-property case is
~60–75% slower cold — 0.021 ms to 0.034 ms, against Ajv's ~12 ms to compile the
same schema.

The published performance table was re-measured for this change, but on Bun
1.3.11 rather than the Bun 1.4 the repo's other tables use; its caption says so,
and it is worth re-running at release time.

`@amritk/helpers` is here only because three of its comments name the
interpreter file that this change renames; nothing it emits changes.
