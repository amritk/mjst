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

Children come from every applicator that names one, not just `properties`:
`allOf` branches merge (properties and requirements both), `anyOf`/`oneOf`/
`then`/`else`/`dependentSchemas` contribute properties without requirements, and
a container's shape is read through `items`/`prefixItems`/`additionalProperties`/
`patternProperties`, including when it sits behind a union. The same rules apply
at the root, so a schema that is one big keyed bag documents its value shape
instead of rendering a title and nothing else.

Schema text is contained wherever it reaches the page: metadata labels and table
cells go through the backtick-run-aware code span, titles and one-line labels
collapse their line endings, fence languages are sanitised, and cross-page link
destinations are percent-encoded. A backtick in a `default` used to close its
code span and leave the rest of the value rendering as live markdown.

Placement mistakes are refused rather than dropped: two pages sharing an id or
resolving to the same file, two sections sharing an id, a page written outside
the output directory or naming no file, and a schema nested past what the walk
can read. A reference to an `$anchor`, or the empty pointer `#` a self-recursive schema
uses, resolves instead of emptying the property that carried it.

`generateMarkdown()` — the README table — is unchanged.
