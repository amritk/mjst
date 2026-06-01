---
"@amritk/yaml": patch
---

Fix `>` folded block-scalar folding to follow YAML 1.2 line-folding rules.
Previously every line break in a folded scalar was collapsed to a space, which
mangled real-world documents (e.g. embedded code samples in the OpenAI OpenAPI
spec). Now:

- **More-indented lines** keep their line breaks — a break adjacent to a line
  indented past the block's base indent stays literal instead of folding to a
  space, and that line's extra indentation is preserved.
- **Blank lines** fold correctly: a run of `p` blank lines between two normal
  lines yields `p` newlines, but `p + 1` when either neighbour is more-indented
  (the entering break is only trimmed when it would otherwise fold to a space).
- **Leading and trailing whitespace lines** are handled per spec — leading
  blank lines survive as line breaks, and a trailing whitespace-only line that
  reaches past the block indent is preserved as content rather than chomped.

Validated against the `yaml` reference parser over the new vendored OpenAPI
corpus and an end-to-end fuzz of randomized folded scalars.
