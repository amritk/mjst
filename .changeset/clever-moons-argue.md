---
'@amritk/generate-markdown': minor
---

Let a section render its properties as one table.

A `x-doc.sections` entry now takes a `layout`, with the same
`'headings' | 'table' | 'none'` vocabulary a property's children already have.
Under `"layout": "table"` the section's properties become one markdown table
under its heading instead of a `###` block each — the summary table a
configuration reference opens with, ordered by the section's own `sort` and
`x-doc.order`, rather than twenty headings a reader has to scroll.

A property in that table still gets the block a row cannot hold below it: the
rest of its prose, its notes, examples, constraints and its own children. `none`
renders the section's prose and examples alone.

A section's layout is its own: it defaults to `headings` whatever the root
`x-doc.layout` says, that one being the default for a *property's* children, so
nothing about an existing schema's output changes.
