# @amritk/generate-markdown — notes for AI coding agents

Renders a `config.schema.json` as documentation, in two shapes: an HTML
config-reference table spliced into a `README.md`, or a multi-page prose
reference (a heading, a **Type:**, the description and an example per property).
Full reference is [README.md](./README.md).

> Pre-alpha: APIs change pre-1.0.

## The API

```ts
import { generateDocs, generateMarkdown, generateMarkdownFiles } from '@amritk/generate-markdown'

// 1. The README table. Takes NO arguments: reads ./config.schema.json from
//    process.cwd() and splices the table into ./README.md between markers.
await generateMarkdown()

// 2. The prose reference, pure: parsed schema in, { filename, content }[] out.
const files = generateMarkdownFiles(schema, { language: 'javascript' })

// 3. The same against the filesystem.
await generateDocs({ schemaPath: './config.schema.json', outDir: './documentation' })
```

## Gotchas — where agents fail

1. **The two entry points behave nothing alike.** `generateMarkdown()` takes no
   arguments, does its own I/O, and returns `void`. `generateMarkdownFiles()`
   takes a schema and returns `GeneratedFile[]` like the other generators in
   this repo, touching no files.
2. **The table splices between markers.** If `README.md` exists but lacks BOTH
   `<!-- config-table-start -->` and `<!-- config-table-end -->`,
   `generateMarkdown` **throws** rather than overwrite hand-written content. The
   prose pages have no such deal: `generateDocs` owns them and overwrites them
   wholesale.
3. **All documentation content belongs in the schema.** Prose, code samples,
   page structure, type labels — everything lives under the `x-doc` vendor
   extension (`page`, `section`, `type`, `title`, `heading`, `layout`, `sort`,
   `order`, `hidden`, `example`/`examples`, `note`/`notes`, `footer`). Do not
   post-process the generated markdown; edit the schema and regenerate.
4. **Placement mistakes throw; they are never silently dropped.** Declare pages
   and sections in the root `x-doc.pages` / `x-doc.sections` before a property
   can reference them. Generation also refuses two pages sharing an id or a
   file (paths are normalised first), a property whose page contradicts its
   section's, and a schema nested past 512 levels. A silent omission would
   leave the docs looking complete, which is the one failure mode to avoid.
5. **Examples are derived when the schema does not supply one.** A property's
   `examples[0]` is wrapped back into the shape of the config file
   (`targets.typescript.packageName` → `{ targets: { typescript: { … } } }`).
   `x-doc.example` replaces that; the remaining `examples` then list inline.
6. **`x-doc.language` decides the dialect of every rendered value**, not just
   the fence label: `json` quotes keys and strings with `"`, `javascript` leaves
   identifier keys bare and quotes with `'`.
7. **Children come from every applicator, not just `properties`.** `allOf`
   branches merge (properties and requirements), `anyOf`/`oneOf`/`then`/`else`/
   `dependentSchemas` contribute properties without requirements, and a
   container's shape is read through `items`/`prefixItems`/
   `additionalProperties`/`patternProperties` — including when it sits behind a
   union. Nothing named is dropped.
8. **Golden output is checked in.** `fixtures/expected/` is compared by
   `generate-markdown-files.test.ts`. After a deliberate renderer change run
   `bun run generate-fixtures` and read the diff — it is the review.

Only the `.` entry. Install: `bun add @amritk/generate-markdown`.
