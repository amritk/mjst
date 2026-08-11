---
'@amritk/lint': patch
---

Stop resolving ruleset and document names against `Object.prototype`, and make
the tags fixer converge.

Five lookups indexed a plain object with a name taken from ruleset or document
input, so any name that happens to be an `Object.prototype` member resolved to
one. A `then.function` of `"toString"` ran instead of being reported unknown,
its string return value iterated one character at a time into a diagnostic
apiece. A rule code of `"toString"` matched the fixer registry and threw out of
`applyFixes`, abandoning every other fix in the batch. An alias of
`#constructor` was written into the alias table as a real own key and then
threw out of the whole lint run. A `severity` of `'constructor'` built a rule
carrying a `Function` where a `DiagnosticSeverity` belongs, so every comparison
against `DiagnosticSeverity.Error` read false and the CLI exited 0 on findings
it should have failed for. And a path parameter legitimately named
`constructor` was reported as "defined multiple times" against a single
definition, while one named `__proto__` never registered at all.

`openapi-tags-alphabetical`'s fixer restated the `alphabetical` built-in's
comparator instead of using it, and the copy had drifted — so
`tags: [{name: "10"}, {name: "2"}]` was flagged by the rule and read as already
sorted by the fixer, surviving every `--fix` pass. The comparator is now shared.
It is deliberately not a total order (that is what lets both `["2","10"]` and
`["0x10","9"]` read as ordered), so the fixer also checks its own sort result
and leaves the array alone rather than emitting an order the rule still rejects
— which used to burn every fix pass and report `converged: false`.

`IFixResult.fixed` is documented as whether any fix changed the document, but
was derived from the applied-fix list; it now reports what it documents. The
own-property guards live in one `core/own-key` module rather than three copies,
and the raw NUL byte in `ruleset.ts` is now the `\0` escape, so the file diffs
as text instead of as binary.
