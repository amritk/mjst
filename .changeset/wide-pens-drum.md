---
'@amritk/generate-parsers': minor
---

Split the cold path out of every generated object parser.

A parser used to carry its whole diagnostic half — a `throw new Error(...)` per
field, each with its own template literal and `"x" in input` probe — in the same
function body as the fast path. That body is large enough to exceed V8's inlining
budget, so every call stayed a real call and every returned object a real
allocation, even for a caller that discards the result.

The emitter now emits two functions per object type (the root and each nested
definition). The exported parser holds only the fast path: one load per field,
one boolean chain, and the result literal built from those loads. Everything else
— the per-property assertions, the undeclared-key rejection, and the general-case
build — moves to a private `_parse<Type>Slow` the fast path hands off to. Nested
fields inlined into the fast path are bound to a local and read once, instead of
being re-read for the literal after the type test.

No behaviour change: the same values parse, the same values throw, with the same
messages in the same order. Under `moltar/typescript-runtime-type-benchmarks`'
harness on Node 22, `parseSafe` goes from ~40M to ~63M ops/s and `parseStrict`
from ~27M to ~32M.

Adds `bun run bench:moltar` to the package: the same parsers under that harness,
with a no-op floor and a discarded/observed pair so a number that is really
dead-code elimination is visible as one.
