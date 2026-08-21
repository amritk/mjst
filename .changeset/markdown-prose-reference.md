---
'@amritk/generate-markdown': minor
---

Add a prose reference renderer, so a config schema can generate a full
documentation guide rather than only a README table.

`generateMarkdownFiles(schema, options?)` returns `{ filename, content }[]` —
one heading per property with a **Type:** line, the description as markdown, the
default, constraints, and a code example, split across as many markdown files as
the schema declares. `generateDocs({ schemaPath, outDir })` writes them.
`renderConfigTable` and `dereferenceSchema` are now exported too.

Everything the output says comes from the schema. A single `x-doc` vendor
extension carries what JSON Schema keywords cannot: `pages` and `sections` place
a property, `example`/`note`/`footer` carry prose and code samples, `type`
overrides a label JSON Schema cannot spell (`(heading: Heading) => string`),
`layout` picks headings, a table, or nothing for a property's children, and
`hidden`/`order`/`sort`/`heading` tune what shows and in what order. When the
schema supplies no example, one is derived from `examples` and wrapped back into
the shape of the config file.

`generateMarkdown()` — the README table — is unchanged.
