---
'@amritk/parsers': minor
---

Add a fail-fast validation mode: a generated `checkX` that stops at the first
violation and reports it.

Between `isX`, which short-circuits and tells you nothing, and `validateX`,
which walks the whole document to collect every error, there was nothing — no
equivalent of Ajv's `allErrors: false`. Composing the two does not work:
`isX(v) ? true : validateX(v)` pays for both passes and measures no faster than
`validateX` alone on failing input. So this is a real emitter rather than a
wrapper.

`checkX(input, _path?)` returns the same `ValidationResult` as `validateX`, with
an `errors` array holding exactly one error — the one `validateX` would have
reported first, identical down to its path, keyword and params. Same type on
purpose: a caller that already renders a `ValidationResult` renders this one
with the code it has. Reach it with a trailing `check` argument to
`buildValidatorSchema` (default `false`, nothing existing moves) or the new
`'check'` mode on `@amritk/parsers`.

On the bench corpus it is 2.5x to 4.7x the throughput of `validateX` on invalid
input, and a wash on valid input where there is nothing to skip. A handful of
unsatisfiable shapes cannot take the short-circuiting form — an `allOf: [false]`,
an always-matching `not`, an `anyOf` whose every branch is statically
impossible — because their report is a `return` no runtime condition guards and
everything behind it is code the consumer's build calls unreachable. Those are
detected while generating, and `checkX` runs `validateX` and hands back its first
error instead: same contract, no short circuit.
