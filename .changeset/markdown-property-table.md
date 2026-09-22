---
'@amritk/generate-markdown': minor
---

Three changes to the property table a `layout: 'table'` renders. Every page the
prose reference generates with one looks different afterwards, so regenerate and
read the diff — nothing needs to be turned on, and there is no flag to keep the
old shape.

**The `Required` column is gone**, and a required property is marked beside its
name instead:

```md
| `organization` _required_ | Identity of the organization publishing the SDKs… |
```

On a real page five rows in twenty are required, so the column carried one bit
and a lot of blanks — and on a narrow viewport it took the width from
**Description**. The marker is the word itself, so the table still needs no
legend under it.

**The `Type` column is dropped when no row fills it with anything actionable** —
the same deal **Default** already had. A table whose every row would say
`object`, or state no type at all, loses nothing by dropping it; one with enums,
arrays or maps (`"comma" | "brackets"`, `string[]`, `Record<string, Target>`)
keeps it. Every row being `string` keeps it too: that is a fact about the
options rather than the absence of one.

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
