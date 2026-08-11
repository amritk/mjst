---
'@amritk/lint': patch
---

Stop resolving ruleset and document names against `Object.prototype`, and make
the tags fixer sort by the comparator its rule judges with.

Three lookups indexed a plain object with a name taken from ruleset or document
input, so any name that happens to be an `Object.prototype` member resolved to
one. A `then.function` of `"toString"` was not reported as an unknown function
— it ran, and its string return value was iterated one character at a time into
a diagnostic apiece. A rule code of `"toString"` matched the fixer registry and
the unguarded `fixer.fix(...)` threw out of `applyFixes`, abandoning every other
fix in the batch. And a path parameter legitimately named `constructor` was
reported as "defined multiple times" against a single definition.

`openapi-tags-alphabetical`'s fixer restated the `alphabetical` built-in's
comparator instead of using it, and the copy drifted: the built-in compares
integer-like strings numerically, the copy fell through to `localeCompare`. So
`tags: [{name: "10"}, {name: "2"}]` was flagged by the rule and read as already
sorted by the fixer, which produced no edit — the finding survived every `--fix`
pass, forever. The comparator is now exported from the rule and imported by the
fixer, which is what the fixer's own comment always said had to be true.

`IFixResult.fixed` is documented as whether any fix changed the document, but
was derived from the applied-fix list — a different question, since a multi-op
fix whose ops are partly deferred rewrites the text without being counted. It
now reports what it documents.
