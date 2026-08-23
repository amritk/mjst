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

A container whose values are another container is followed as far as it goes,
so a matrix, a list of maps, or a map of arrays documents the fields at the
bottom of it rather than stopping at the outer shape.

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

A recursive reference collapses where it repeats, labelled with the type its
definition has and carrying that definition's documentation the way any other
ref site does — its prose, its type label, its layout, its examples, whether it
is hidden — plus what the definition says about the value itself (`deprecated`,
`default`, `examples`, every constraint keyword) and what it requires, so the alternative
beside it keeps its **Required** markers. What stays behind is what places and announces an
occurrence rather than describing it: `x-doc.page`, `section`, `title`,
`heading` and `order`. A reference that resolves to the document itself — `#`,
`#/`, or the root's own `$anchor` — carries nothing, the root being a page
configuration rather than a definition. Reading what a definition requires
refuses to re-enter one already on the path and is worked out once per pointer,
so a combinator language (`Filter` is `And` or `Or`, each inheriting `Filter`)
renders instead of never finishing.

A table row is one line, so a code block never goes in one: a description
opening with a fenced or indented sample gives the row its first paragraph of
prose, and the sample prints below the row with its indentation intact — it used
to reach the reader de-indented, as live markup, and nowhere else on the page.

In the **Type:** label an `allOf` reads as an intersection (`a & b`) rather than
as a union, and a page file is percent-encoded as a path — `#` and `?` in a file
name are encoded rather than left to read as a fragment and a query.

`generateMarkdown()` — the README table — is unchanged.
