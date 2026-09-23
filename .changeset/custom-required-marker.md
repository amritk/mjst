---
"@amritk/generate-markdown": minor
"@amritk/mjst": minor
---

Let a schema choose what marks a required property in a table.

The root `x-doc.table.requiredMarker` replaces the ` _required_` that the `marker` style appends to a required property's name. It is markdown or inline HTML, appended exactly as written, so the author picks the separator: `"*"` hugs the name and `" *"` does not. Line endings become spaces and live `|`s are escaped so a marker cannot break its row; an empty string renders no marker. It is ignored under `required: 'column'`. `MarkdownOptions.table.requiredMarker` and `mjst markdown --required-marker <text>` override it.

```json
{ "x-doc": { "table": { "requiredMarker": "<br><sub><i>required</i></sub>" } } }
```

| Property                                 | Type     | Description                |
| ---------------------------------------- | -------- | -------------------------- |
| `host`<br><sub><i>required</i></sub>     | `string` | The host to bind.          |
| `port`                                   | `number` | The port to bind.          |
