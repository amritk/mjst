---
'@amritk/lint': patch
---

Document the one thing `restrictTo` does not cover: a regular expression a
ruleset writes (in `pattern`'s `match`/`notMatch`, or as a literal inside a
`[?(...)]` filter) is run against text from the document, so an ambiguous pattern
can backtrack catastrophically on input crafted to trigger it — a hostile
*document* hanging the linter through a regex the *ruleset* provided.
