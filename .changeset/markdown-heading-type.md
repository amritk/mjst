---
"@amritk/generate-markdown": minor
"@amritk/mjst": minor
---

Let a schema drop the **Type:** line from its headings, and keep an enum's values on the page when a type label is hidden.

The root `x-doc.headings.type` takes `auto` (the default: every heading states its type, as before) or `never`, which drops the **Type:** line under every property heading on every page. **Required** stays. `MarkdownOptions.headings.type` and `mjst markdown --type-label <auto|never>` override it.

```json
{ "x-doc": { "headings": { "type": "never" } } }
```

An enum's **Allowed values:** line used to be skipped whenever the property's type label spelled the values out, even when that label was not printed. Hiding the label therefore hid the values too. The line is now skipped only when the reader can see the label. This also fixes `x-doc.table.type: 'never'`: an enum under a type-less table now gets a block below its row listing its allowed values, and the row links to it. Schemas that use that setting will see new `### name` blocks, so regenerate and read the diff.
