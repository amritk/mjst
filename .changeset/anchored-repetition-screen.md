---
'@amritk/runtime-validators': minor
'@amritk/generate-examples': patch
---

The ReDoS screen now admits separator-delimited repetitions it used to reject.

**What changes for you:** a `pattern` of the shape `(<sep><body>)*` or
`(<body><sep>)*` — a dotted identifier chain, a slash-delimited pointer, a
comma-separated list — is no longer refused as "nested unbounded quantifiers".
Schemas that previously threw at `validate()` time, or needed
`limits: { allowUnsafePatterns: true }`, now build. That part is one-directional:
across 1.5 million generated patterns the exemption never turned an accepted
pattern into a rejected one.

**One such loop per concatenation.** Two of them side by side keep being refused,
because two nullable loops compose — see below — and the rule does not try to work
out whether a particular pair can. So `^\d+(\.\d+)*$` builds where it used to
throw, while `^\d+(\.\d+)*(-[a-z]+)*$` still throws, even though its two loops
have disjoint separators and it is in fact linear. Both were refused before this
release, so nothing regresses; but if you were hoping a semver or host-and-port
pattern would start building, it will not. `allowUnsafePatterns` remains the
escape hatch, and a rule that proved the two loops' alphabets disjoint would be
the way to lift it.

**Two parser fixes ride along, and they do newly reject a narrow set.** Both were
pre-existing bugs that let a genuinely exponential pattern through:

- The class scanner applied the POSIX "a leading `]` is a literal member" rule,
  which ECMAScript does not have — `[]` is the empty class and `[^]` is any
  character. A `[^]` therefore swallowed the rest of the pattern into one atom
  and hid whatever followed: `^[^]*(a+)+$` contains a textbook `(a+)+` and was
  accepted, at 4 seconds on 28 characters.
- A braced escape (`\u{61}`, `\p{L}`) was read as two code units, leaving `{61}`
  to be taken for a bounded quantifier that then swallowed the real `+` — so
  `^(\u{61}+)+$`, which *is* `^(a+)+$`, lost a level of star height. Its payload
  is now validated as it is scanned, since a span the escape cannot legally
  carry is not an escape under either compile mode: `\p{(a+)+}` is a
  `SyntaxError` with `u`, so the fallback compile runs the `(a+)+` inside it.

Most of what these newly reject is genuinely unsafe, but not all of it: rule 1 is
an over-approximation, and a braced escape in atom position now costs the
anchored exemption even where the same pattern spelled in ASCII keeps it — so
`^(\u{61}+x)+$` is refused while `^(a+x)+$`, which it is identical to, is
admitted. Both are linear; the refusal is a false positive, in the safe
direction. Ordinary standalone uses (`\u{61}+`, `\p{Script=Latin}+`,
`[\u{61}-\u{7A}]+`, `[^]*`) keep their previous verdicts.

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

The waived level comes back whenever something can compose the exempted loop with
itself. What the exemption establishes holds for one pass; `(BODY)*` still matches
the empty string however unambiguous BODY is. A quantifier around it composes
those matches — a *bounded* one too, which is the case that looks harmless, and
`^((-a*)*){0,50}$` is 2^n. So does simply writing the loop twice in a row:
nothing pins which copy owns which word, and `^(-a*)*(-a*)*…$` with eight of them
is degree-8 polynomial, 5.6 seconds on 43 characters. One loop is the case the
exemption is for; two is where it stops holding.

The second condition is the one that is easy to miss, and omitting it is not
safe: a backtracking engine explores derivations, not splits, so a body that
matches its own substring k ways costs k^n over n repetitions even with every
boundary pinned. `^(\.((\w[a-z]?|b\w+)?|(a*[a-z0-9]?)?))*$` is separator-anchored
and takes 94 ms on 22 characters where its body alone takes none.
`^([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$` — genuinely exponential,
8.9 seconds on 30 characters — is still refused, as is every classic shape
(`(a+)+`, `(a*)*`, `(a|a)+`).

The screen remains a best-effort filter rather than a proof of safety, with the
same known gaps. The new analysis is capped by its own shared budget, charged by
span for every character it examines and every character-class comparison it
makes, and its cost against a hostile source plateaus around 15 ms. That is
not a claim about the screen as a whole: the pre-existing ambiguous-alternation
rule spends its budget per branch
pair while each comparison may compile a character class, so a 176 KB alternation
of literals and long classes costs ~200 ms to screen. Unchanged here, and
unchanged by this release.

`@amritk/generate-examples` only retargets a test fixture that had used
`^(repeat+)+once$` to stand for a refused pattern — that one is admitted now,
and measures linear.
