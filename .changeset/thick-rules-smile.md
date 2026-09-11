---
'@amritk/generate-markdown': minor
---

Let a schema declare columns of its own in the config table. A root
`x-extra-columns` map (`{ "x-scalar-stability": "Stability" }`) adds one column
per entry, read off each property under the same keyword — so vendor data
reaches the table without this package having to know the keyword. The columns
render after the built-in ones in declaration order, share the same rules (a
column no property fills is dropped, headers and values are escaped, every
nested table keeps the same shape), and take scalar values.

Also adds `generateConfigTable(options)`: the table flow with the schema and
markdown paths spelled out, returning the path it wrote. `generateMarkdown()`
keeps its zero-argument shape and now wraps it.
