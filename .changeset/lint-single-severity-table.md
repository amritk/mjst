---
'@amritk/lint': patch
---

One severity table and one finding comparator, instead of three and two.

The severity-name mapping was written out in three places (rule normalization,
pointer-scoped overrides, and parser options) and the finding-order comparator in
two. Nothing was wrong with any individual copy after the preceding fixes, but a
severity added to one of them would have been silently missing from the others.
Both now live in one module each.

Also extends the fuzz sweep to the JSONPath compiler: a path that fails to
compile must match nothing (falling back to the document root would run a rule
against the whole file), and evaluating a batch of paths must return exactly what
evaluating each one alone does.
