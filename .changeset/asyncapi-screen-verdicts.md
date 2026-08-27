---
'@amritk/lint': patch
---

Pin the AsyncAPI meta-schema regex verdicts to what the ReDoS screen actually
does today.

The three upstream patterns this package rewrites were all refused by
`@amritk/runtime-validators` when the schemas were vendored, and a test asserted
that refusal as the reason for each rewrite. The screen has since been relaxed
to admit *separator-anchored* repetitions — a loop whose every iteration must
begin with a character the body cannot itself produce — and it named two of
these three as its motivating cases. Only the genuinely exponential one is still
refused, so the test's premise was false for the other two.

The test now records the expected verdict per pattern and asserts it in both
directions: a refusal that becomes an acceptance and an acceptance that becomes
a refusal both fail. Pinning only the refusals would let a later relaxation
quietly admit the exponential pattern; pinning nothing would hide a
re-tightening that made these schemas fail to build again.

All three rewrites stay. Two are no longer required for the schemas to build,
but each is proven equivalent to its upstream over a generated corpus, and one
flat loop reads more clearly than a nested pair. The README, `AGENTS.md`, and
the architecture guide previously said all three were refused; they now say
which is, and why the other two are kept anyway.

No runtime behaviour changes.
