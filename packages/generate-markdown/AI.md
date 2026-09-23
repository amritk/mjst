# @amritk/generate-markdown — notes for AI coding agents

Renders a `config.schema.json` as documentation, in two shapes: an HTML
config-reference table spliced into a `README.md`, or a multi-page prose
reference (a heading, a **Type:**, the description and an example per property).
Full reference is [README.md](./README.md).

> Pre-alpha: APIs change pre-1.0.

## The API

```ts
import {
  generateConfigTable,
  generateDocs,
  generateMarkdown,
  generateMarkdownFiles,
} from '@amritk/generate-markdown'

// 1. The README table. Takes NO arguments: reads ./config.schema.json from
//    process.cwd() and splices the table into ./README.md between markers.
await generateMarkdown()

// 2. The same table, with the paths spelled out. Returns the path it wrote.
await generateConfigTable({ schemaPath: './settings.schema.json', readmePath: './docs/config.md' })

// 3. The prose reference, pure: parsed schema in, { filename, content }[] out.
const files = generateMarkdownFiles(schema, { language: 'javascript' })

// 4. The same against the filesystem.
await generateDocs({ schemaPath: './config.schema.json', outDir: './documentation' })
```

Both shapes are also a CLI command — `mjst markdown <schema> --out-dir <dir>`,
or `mjst markdown <schema> --table --readme <file>`.

## Gotchas — where agents fail

1. **The two entry points behave nothing alike.** `generateMarkdown()` takes no
   arguments, does its own I/O, and returns `void` — `generateConfigTable(opts)`
   is that same flow with the paths spelled out. `generateMarkdownFiles()` takes
   a schema and returns `GeneratedFile[]` like the other generators in this
   repo, touching no files.
2. **The table splices between markers.** If `README.md` exists but lacks BOTH
   `<!-- config-table-start -->` and `<!-- config-table-end -->`,
   `generateMarkdown` **throws** rather than overwrite hand-written content. The
   prose pages have no such deal: `generateDocs` owns them and overwrites them
   wholesale.
3. **All documentation content belongs in the schema.** Prose, code samples,
   page structure, type labels — everything lives in the `x-mjst` vendor
   extension, the same object the type generators read `brand`/`instanceOf`
   from, with each key meaning what its position says. Renderer settings go
   under `x-mjst.markdown` (`page`, `section`, `type`, `title`, `heading`,
   `layout`, `sort`, `order`, `example`/`examples`, `note`/`notes`, `footer`
   on a property; `pages`, `sections`, `table`, `headings`, `language`… on the
   root). `hidden` is not markdown-specific, so it sits on `x-mjst` itself:
   `"x-mjst": { "hidden": true }` (one under `markdown` throws). Do not post-process the generated
   markdown; edit the schema and regenerate. `layout`
   (`'headings' | 'table' | 'none'`) is read on a property, where it lays out
   that property's children, and on a root `x-mjst.markdown.sections` entry,
   where it lays out the section: `table` renders the whole grouping as one
   markdown table. A section defaults to `headings` whatever the root `layout`
   says, that one being the default for a property's children.
4. **Placement mistakes throw; they are never silently dropped.** Declare pages
   and sections in the root `x-mjst.markdown.pages` /
   `x-mjst.markdown.sections` before a property can reference them. Generation also refuses two pages sharing an id or a
   file (paths are normalised first), a property whose page contradicts its
   section's, and a schema nested past 512 levels. A silent omission would
   leave the docs looking complete, which is the one failure mode to avoid.
5. **Examples are derived when the schema does not supply one.** A property's
   `examples[0]` is wrapped back into the shape of the config file
   (`targets.typescript.packageName` → `{ targets: { typescript: { … } } }`).
   `x-mjst.markdown.example` replaces that; the remaining `examples` then list
   inline.
6. **`x-mjst.markdown.language` decides the dialect of every rendered value**,
   not just the fence label: `json` quotes keys and strings with `"`, `javascript` leaves
   identifier keys bare and quotes with `'`.
7. **Children come from every applicator, not just `properties`.** `allOf`
   branches merge (properties and requirements), `anyOf`/`oneOf`/`then`/`else`/
   `dependentSchemas` contribute properties without requirements, and a
   container's shape is read through `items`/`prefixItems`/
   `additionalProperties`/`patternProperties` — including when it sits behind a
   union. Nothing named is dropped.
8. **The table's columns are the schema's to extend.** A root
   `x-extra-columns` map (`{ "x-scalar-stability": "Stability" }`) adds a column
   per entry, read off each property under the same keyword — the way to get
   vendor data into the table without teaching this package the keyword. Root
   only, rendered after the built-in columns, dropped when no property fills it,
   and scalar values only (a string, number, or boolean; anything else leaves
   the cell empty).
9. **A property table's shape is the root `x-mjst.markdown.table`'s, not the renderer's.**
   `{ type, default, required, requiredFirst }`: the two columns take
   `'auto' | 'always' | 'never'` and default to `auto` — rendered only when a
   row fills them with something a reader could act on, so a table whose every
   row says `object` has no **Type** column. `required` is `'column'` (the
   default: a **Required** column with ✅, dropped when no row is required) or
   any other string, which is a suffix after each required name instead —
   markdown or inline HTML (`" _required_"`, `"*"`, `""` for nothing),
   appended verbatim so the author picks the separator, with line endings
   collapsed and live pipes escaped. `requiredFirst` heads each table with the
   required properties, still as one table. Root only — per-property and
   per-section tables all follow it — and `MarkdownOptions.table` / the CLI's
   `--type-column`, `--default-column`, `--required-style`, `--required-first`
   override it per member.
   The root `x-mjst.markdown.headings.type` (`'auto' | 'never'`, CLI `--type-label`) does
   the same for the **Type:** line under a heading. An enum spelled out by a
   label the reader can see gets no **Allowed values:** line; once the label is
   gone (`headings.type: 'never'`, or `table.type: 'never'` for a block under a
   row) the values are listed. An empty `x-mjst.markdown.type` counts as unset, so it
   does not hide the line.
10. **Table rows link to the headings below them, and the anchors are not
   hand-written.** A row links to the property's own heading when it has one, on
   this page (`#packagename`) or the page it moved to
   (`configuration/typescript.md#packagename`), and stays a plain code span when
   the row already says everything. The anchors are claimed by the headings as
   they render — a repeat is numbered `#name-1` the way a docs site does — so a
   link is never derived from a property name by hand.
11. **Golden output is checked in.** `fixtures/expected/` is compared by
   `generate-markdown-files.test.ts`. After a deliberate renderer change run
   `bun run generate-fixtures` and read the diff — it is the review.

Only the `.` entry. Install: `bun add @amritk/generate-markdown`.
