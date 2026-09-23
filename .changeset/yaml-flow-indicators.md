---
"@amritk/yaml": minor
---

Tighten flow collections and plain-scalar starts to match YAML 1.2. Some documents that used to parse cleanly now report errors, and a few now produce different values:

- **New `BAD_SCALAR_START` errors.** A plain scalar can no longer start with a c-indicator. Previously only `@` and `` ` `` were rejected; now `a: ]`, `a: }`, `a: ,x`, `a: %x`, `[|]`, `[>]`, `[%]` and keys like `>k: 1` / `]k: 1` are rejected too. So is a `?` that is not followed by content (`a: ?`, `a: ? x`, `[?]`, `{?}`). `-1`, `?x`, `:x`, `x%y` and a `%` at the start of a continuation line are still accepted.
- **New `BAD_INDENT` errors.** Inside a flow collection opened from block context, continuation lines of quoted and plain scalars must be indented deeper than the enclosing block (`a: ["x\ny"]`, `a: {b: c\nd}`, `- [a\nb]`). Root flow collections, and so JSON, are not affected.
- **Escaped line breaks.** In a double-quoted scalar, `\` at the end of a line now goes through the same continuation-line checks as any other line break. The indentation check now gives the same result for LF and CRLF, and a column-0 `---`/`...` ends an unterminated scalar.
- **Changed values.** `[ ? a ]` is now `[{ a: null }]` (was `["a"]`), and `[ ? ]` is now `[{ "": null }]`. `{a:{b: 1}}` and `{a:[1]}` now parse as `{ a: { b: 1 } }` / `{ a: [1] }` instead of reporting an unterminated flow collection. `? a` / `: ? b` now gives a nested mapping `{ a: { b: null } }` (was the string `"? b"`).
