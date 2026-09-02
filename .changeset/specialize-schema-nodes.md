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
Steady-state throughput is up **27–179%** across the bench suite (the biggest
win on the `moltar/typescript-runtime-type-benchmarks` shape now in `bench/`,
where guard throughput more than doubles), and the `@amritk/api` request path
gains 5–11% where validation is on the critical path.

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
never pays for `$defs` its data does not reach. That deferral runs deeper than
the node: a node's type-specific block is built only once a value of that type
gets past the type check, and a `properties` entry only once a value reaches it.
A `{ type: 'object', properties: … }` node meeting a string or `null` — most of
what a union throws at it — now costs a type test and nothing else.

Cold cost still moves, because a node's step is a few closures where its
metadata was one object, and how much depends entirely on how much of the schema
the data touches. Measured over the vendored OpenAPI corpus (982 real component
schemas, each prepared and used once) it is **~6% slower on average**, and a
`$ref`-heavy schema is *faster* cold, because a target is specialized once and
reused across every array element rather than re-walked. The worst case is a
schema whose data reaches everything it declares — the 40-property bench case,
validated once against an instance carrying all forty — which stays around twice
its old cold cost, against Ajv's ~11 ms to compile the same schema. There is no
way around that one: specializing a node is the cost, and that case specializes
all of it and then uses each step once.

The published performance table was re-measured for this change, but on Bun
1.3.11 rather than the Bun 1.4 the repo's other tables use; its caption says so,
and it is worth re-running at release time.

`@amritk/helpers` is here only because three of its comments name the
interpreter file that this change renames; nothing it emits changes.
