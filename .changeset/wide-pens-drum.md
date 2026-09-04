---
'@amritk/generate-parsers': minor
---

Move a generated object parser's diagnostics out of its fast path.

A parser used to carry its whole diagnostic half — a `throw new Error(...)` per
field, each with its own template literal and `"x" in input` probe — in the same
function body as the fast path. That body is large enough to exceed V8's inlining
budget, so every call stayed a real call and every returned object a real
allocation, even for a caller that discards the result.

The per-property assertions now live in a private `_assert<Type>` the fast path
calls as a *statement* when its type chain fails, and the object check in a
`_assert<Type>Object` assertion function. The build stays where it was, so the
fast path keeps the single `return` it always had — which matters: an earlier
version moved the build out too and handed off with `return _parse<Type>Slow(input)`,
making the returned value a phi of the local literal and an opaque call result.
JavaScriptCore then cannot scalar-replace the literal, and every flat parser under
~24 properties measured ~3x slower on Bun against a caller that reads the parsed
fields. Coerce parsers have no diagnostics to move — their cold half *is* the
returned value — so they keep the single-function form unchanged.

Nested fields inlined into the fast path are now bound to a local and read once
instead of being re-read for the literal after the type test, and the inlined
condition drops the `typeof`/`!== null`/`!Array.isArray` prefix the caller's
guard has already proven.

No behaviour change: the same values parse, the same values throw, with the same
messages in the same order.

Measured, Node 22, caller reads every parsed field: the moltar `assert` shape
goes 16.4M → 23.4M ops/s. Under `moltar/typescript-runtime-type-benchmarks`'
own harness, `parseSafe` goes ~40M → ~65M. Bun is unchanged across the board.
One case pays for it: the nested `Order · safe` shape is ~5% slower under this
package's harness.

Adds `bun run bench:moltar` to the package: the same parsers under that harness,
with a no-op floor and a discarded/observed pair so a number that is really
dead-code elimination is visible as one.
