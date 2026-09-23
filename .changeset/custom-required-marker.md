---
"@amritk/generate-markdown": minor
"@amritk/mjst": minor
---

Let a schema choose how a property table marks required properties, and make the **Required** column the default.

`x-mjst.markdown.table.required` is now `"column"` or any other string. `"column"` — the default — renders a **Required** column with a ✅, dropped when no row is required. Any other string is a suffix put right after each required property's name, as markdown or inline HTML, appended exactly as written: `"*"` hugs the name, `" *"` does not, and `""` marks nothing. Line endings become spaces and live `|`s are escaped so a suffix cannot break its row. `MarkdownOptions.table.required` and `mjst markdown --required-style <text>` take the same values.

```json
{ "x-mjst": { "markdown": { "table": { "required": "<br><sub><i>required</i></sub>" } } } }
```

| Property                             | Type     | Description       |
| ------------------------------------ | -------- | ----------------- |
| `host`<br><sub><i>required</i></sub> | `string` | The host to bind. |
| `port`                               | `number` | The port to bind. |

**Breaking:** tables that set no `required` now get the **Required** column instead of `` `name` _required_ ``; set `"required": " _required_"` to keep the old output. `"marker"` is no longer a keyword — it is read as a literal suffix like any other string, so replace it with `" _required_"`. `--required-style` no longer rejects values other than `marker` and `column`.
