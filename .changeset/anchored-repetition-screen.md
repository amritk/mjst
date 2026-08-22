---
'@amritk/runtime-validators': minor
'@amritk/generate-examples': patch
---

The ReDoS screen now admits separator-delimited repetitions it used to reject.

**What changes for you:** a `pattern` of the shape `(<sep><body>)*` or
`(<body><sep>)*` — a dotted identifier chain, a slash-delimited pointer, a
comma-separated list — is no longer refused as "nested unbounded quantifiers".
Schemas that previously threw at `validate()` time, or needed
`limits: { allowUnsafePatterns: true }`, now build. Nothing that used to be
accepted is rejected: the change is one-directional.

`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$` and
`^\$message\.(header|payload)#(\/(([^\/~])|(~[01]))*)*` — both from the official
AsyncAPI meta-schemas — are the motivating cases. Star height alone called them
catastrophic; on V8 they match a failing 30-character input in under 0.05 ms.

**Why it is sound.** Star height >= 2 is still the rule; a repetition is now
exempt from *counting toward* it when two things hold together. First, the body
carries a literal character at a fixed end that no other atom in it can produce,
so the positions of that character are the word boundaries and no input can be
split two ways. Second, the body derives each word exactly once — checked over a
deliberately small grammar (no `?`, no `{n,m}`, a repeated atom may not run into
what follows it, a trailing alternation must be settled by its first character).

The second condition is the one that is easy to miss, and omitting it is not
safe: a backtracking engine explores derivations, not splits, so a body that
matches its own substring k ways costs k^n over n repetitions even with every
boundary pinned. `^(\.((\w[a-z]?|b\w+)?|(a*[a-z0-9]?)?))*$` is separator-anchored
and takes 94 ms on 22 characters where its body alone takes none.
`^([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$` — genuinely exponential,
8.9 seconds on 30 characters — is still refused, as is every classic shape
(`(a+)+`, `(a*)*`, `(a|a)+`).

The screen remains a best-effort filter rather than a proof of safety, with the
same known gaps, and it stays cheap on a hostile pattern: the new analysis is
capped by its own shared budget, charged per character examined and per
character-class comparison, and the worst adversarial source found screens in
about 40 ms.

`@amritk/generate-examples` only retargets a test fixture that had used
`^(repeat+)+once$` to stand for a refused pattern — that one is admitted now,
and measures linear.
