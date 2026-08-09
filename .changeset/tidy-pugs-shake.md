---
'@amritk/generate-markdown': patch
---

Fix a set of correctness bugs in the config-table renderer, found by an audit of
the whole package:

- Control characters in a string `default`/`enum`/`examples` member are now
  escaped. A raw newline ended the `<table>`'s HTML block mid-row, so every tag
  after it rendered as literal text.
- The README splice looks for the end marker *after* the start marker. Prose
  above the region mentioning `<!-- config-table-end -->` made it slice
  backwards, duplicating the region on every run and growing the file without
  bound.
- Property names are escaped before they reach the anchor `id`/`href` and the
  `####` heading — a name containing `"` terminated the attribute early.
- Detail tables get unique anchor ids. A property named `a.b` and `b` nested
  under `a` both rendered as `config-a-b`, so one table was unreachable.
- `null` inside `enum`/`examples` renders as `null` instead of being dropped and
  leaving a dangling separator.
- `$ref`-shaped values inside `default`/`const`/`enum`/`examples` are no longer
  inlined; they are documented config values, not references. A property
  legitimately named `default` is still treated as a schema.
- A non-string `x-cli-flag`/`x-icon` no longer throws a bare `TypeError`, an
  empty `x-cli-flag` no longer adds an always-blank column, and a schema with no
  `properties` renders instead of crashing.
