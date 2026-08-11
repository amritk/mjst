---
'@amritk/api': patch
---

Do not let a `/` heuristic step over a contract. `nextCallSite` guessing that a
`/` opens a regex is the one literal guess with nothing on the other side of
it, so a "regex" spanning a `defineContract` is simply wrong and the `/` is now
read as ordinary. Quotes and backticks deliberately keep no such check: a call
site quoted inside a real string or template must be skipped, which is the
opposite rule, and no single test separates that from JSX text on the same line
— the scanner's docs now say so plainly, along with the fact that the outcome
there is the module's documented failure mode (a bigger bundle, not a broken
one) and that a call site on its own line is never in question.
