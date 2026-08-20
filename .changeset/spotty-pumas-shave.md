---
'@amritk/runtime-validators': minor
---

Harden the interpreter against hostile schemas, and share one copy of the keyword sets.

- `$schema`/`$vocabulary` are now read as own keys. A polluted `Object.prototype.$vocabulary` alongside a `$schema` naming a registered document turned the whole 2020-12 validation vocabulary into annotations, so `type`, `enum`, `required` and the bounds stopped asserting and every value validated.
- The ReDoS screen no longer becomes a denial of service itself. Its group descent is depth-capped (a deeply nested pattern raised an uncatchable `RangeError` instead of a `ValidationLimitError`), and its pairwise ambiguity scan runs on a shared comparison budget (a few kilobytes of `(a|b|c|…)+` pinned a CPU for minutes at build time).
- A `$ref`, `$dynamicRef` and `$recursiveRef` each get their own key namespace in the shared resolved-target cache. A `$ref` to an unregistered URI spelled `dyn:#x` read back the target of an earlier `$dynamicRef: '#x'` instead of failing loudly.
