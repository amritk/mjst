---
"@amritk/generate-markdown": minor
---

Add opt-in `x-mjst.markdown.headings.promoteBold` (and `MarkdownOptions.headings.promoteBold`). When it is `true`, a top-level paragraph that is only one bold span (`**First release**`, optionally followed by `:`) becomes a real heading in the markdown output, one level below the heading that owns the text and capped at 6. The heading drops one trailing `.` or `:`. Promoted headings get page-unique anchors through the same registry as every other heading, and step ids skip them. Lead-ins stay bold, and so do bold paragraphs in fences, blockquotes, lists, raw HTML and step bodies. A table row keeps its summary. Output is unchanged unless the option is set, and a value that is not a boolean is an error. TypeScript consumers who build a `DocHeadings` value themselves now have to supply `promoteBold`.
