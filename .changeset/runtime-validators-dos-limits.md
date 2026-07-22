---
"@amritk/runtime-validators": minor
---

Add resource limits that keep an adversarial schema or input from turning a
validation into a denial-of-service. The interpreter walks arbitrary (and
possibly untrusted) schemas over arbitrary data, so four unbounded costs are now
bounded — all on by default, all configurable via a new `limits` option on
`validate`/`validateGuard`/`assert`:

- **Recursion depth** (`limits.maxDepth`, default 512): deeply-nested data
  against a recursive schema (`{ items: { $ref: '#' } }`) no longer recurses into
  the native stack limit as an uncatchable `RangeError`.
- **Total work** (`limits.maxSteps`, default 10,000,000): a nested `anyOf`/`oneOf`
  that re-evaluates every branch against one value (`2^depth` evaluations from a
  few kilobytes of schema) now trips a shared step budget instead of pinning a
  CPU.
- **`uniqueItems`**: the structural-equality check is now hash-bucketed, so an
  array of distinct objects is ~O(n) instead of O(n²) (a 40k-element array went
  from tens of seconds to milliseconds). `deepEqual` semantics are unchanged.
- **ReDoS**: a schema `pattern` (or `patternProperties` key) with nested
  unbounded quantifiers (`(a+)+$`, star height ≥ 2) is rejected when the
  validator is built, before it can be run natively against input. Opt out per
  call with `limits.allowUnsafePatterns: true`.

Exceeding a runtime limit throws a `ValidationLimitError` — the same fail-loud
contract the interpreter already uses for an unresolvable `$ref` or unknown
`type` — recognizable via the newly exported `isValidationLimitError`. The
`ValidateLimits` type is exported too. Ordinary schemas and documents stay well
under every default. `@amritk/api`, which validates requests through this
package, inherits the protection.
