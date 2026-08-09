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
- Line endings are collapsed in *every* cell, not just formatted values — a
  newline in a property name, `x-cli-flag`, `x-icon` or type ended the table's
  HTML block the same way.
- A property named `__proto__` is documented instead of silently vanishing
  (plain assignment set the prototype).
- A non-finite `default` renders the way a nested one already did, rather than
  documenting `Infinity` — which is not JSON.
- Keywords whose value has the wrong type (`enum: "abc"`, `required: 5`,
  `description: 5`, `properties: null`) no longer throw a bare `TypeError`
  naming neither the property nor the file.

