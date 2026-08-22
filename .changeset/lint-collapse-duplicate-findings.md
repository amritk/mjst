---
'@amritk/lint': patch
---

Collapse findings that are indistinguishable from one already reported.

A rule with `resolved: true` walks the dereferenced document, where one reusable
`components` entry appears once per `$ref` that reaches it *and* once at its
declaration. Every copy maps back through the source map to the same node, so a
single authored mistake in a message used twice was reported three times, at
byte-identical `line:column` with byte-identical text. On a vendored AsyncAPI
example this meant four findings for two mistakes; the OpenAPI preset behaves
the same way, and always has.

`lintWithResult` now drops a finding when an earlier one matches it on rule,
severity, message, range and source — everything a reader can see. The internal
`path` is deliberately not part of that comparison: two findings differing only
in the path they were reached by are the same finding as far as the report is
concerned. Anything differing in rule, wording, severity or position is kept, so
this collapses duplicates and never distinct findings.
