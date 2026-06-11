---
"@amritk/generate-parsers": minor
---

Reshape the generated strict object parser to be guard-first, so a valid input is
no longer validated twice before being copied. Previously the strict parser ran
the full per-property assertion list and *then* the fast-path shape check before
returning `{ ...input }`; now the cheap shape guard runs first and the
per-property assertions only run to pinpoint the error when the guard rejects the
input — mirroring the validator hot/cold split. The strict build also assigns
each field straight from its checked value instead of re-running the coercion
ternaries, which are dead once the guard (or the assertions) have proven the
type.

`stripUnknown` gains a dedicated shallow-guard fast path: a well-typed input
skips the assertions and goes straight to the strip build (which removes extras
and recurses into each sub-parser), so the common parse-and-strip case is no
longer forced down the slow path by the extras it is about to remove.

The exported parser API and all behaviour (throws, strips, rejects) are
unchanged. On the `moltar/typescript-runtime-type-benchmarks` parse shapes this
lifts steady-state valid throughput notably on parseSafe (e.g. ~9.3M→~12.3M on
the small shape, ~3.6M→~5.3M on the nested order shape) and on parseStrict for
the codegen-heavy nested shapes.
