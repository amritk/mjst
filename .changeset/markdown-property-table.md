---
'@amritk/generate-markdown': minor
'@amritk/mjst': minor
---

The property table a `layout: 'table'` renders is now the schema's to shape,
through a root `x-doc.table`, and its defaults changed. Every page generated
with a table looks different afterwards, so regenerate and read the diff.

```json
{
  "x-doc": {
    "table": { "type": "never", "required": "split" }
  }
}
```

| Member | Values | What it decides |
| --- | --- | --- |
| `type` | `auto` (default), `always`, `never` | The **Type** column |
| `default` | `auto` (default), `always`, `never` | The **Default** column |
| `required` | `marker` (default), `column`, `split` | How requiredness is said |

Root only, so every table on every page agrees;
`generateMarkdownFiles(schema, { table })` and `mjst markdown`'s
`--type-column`, `--default-column` and `--required-style` override it per
member.

**`auto` is new, and it is the default for both columns.** A column is rendered
when a row fills it with something the reader could act on — **Default**
already worked that way, and **Type** now does too. A table whose every row
would say `object`, or state no type at all, drops the column; one with enums,
arrays or maps (`"comma" | "brackets"`, `string[]`, `Record<string, Target>`)
keeps it, and so does one where every row is `string`, that being a fact about
the options rather than the absence of one.

**Requiredness defaults to `marker`**, so the `Required` column is gone unless
a schema asks for it back with `"required": "column"`:

```md
| `organization` _required_ | Identity of the organization publishing the SDKs… |
```

On a real page five rows in twenty are required, so the column carried one bit
and a lot of blanks, and on a narrow viewport it took the width from
**Description**. `"required": "split"` is the third answer: the required
properties in a **Required** table and the rest under **Optional**, for a reader
skimming for what they have to fill in. Both halves share one set of columns,
and the blocks below the table are reordered with the rows.

**A row now links to the property's own section on the same page.** Linking was
already there but gated on the page differing, so a property with a `###`
section directly below the table — its example, its notes, its own nested table
— was left an inert code span, and a reader had to scroll and search for it. It
is a link now (`[`organization`](#organization)`), and a property whose
section lives on another page gets the anchor as well
(`configuration/typescript.md#packagename`) rather than just the file.

Only the properties that actually have a heading are linked. Most rows in a
table say everything they have to say and get no section at all, and a link to
an anchor no heading answers takes the reader nowhere with nothing in the
markdown that looks wrong — so the heading itself claims the anchor as it
renders, and the row reads back what it claimed. Anchors follow GitHub's rules,
slugged from the text the heading renders as rather than its markdown, and a
page that carries a name twice numbers the second `#name-1`. A cross-page anchor
is the one that is not numbered: a page's anchors are that page's to hand out.
