---
"@amritk/yaml": patch
---

- Fix line folding in plain, single-quoted, double-quoted and flow scalars stripping Unicode spaces, such as a no-break space or an ideographic space, from the edges of a line. YAML strips only spaces and tabs, and the text an author wrote now survives.
- `nodeAtPath` reads a string array index only in its canonical spelling. `''`, `' 1'`, `'0x1'` and `'1e0'` no longer find an element.
- Unescape double-quoted scalars by copying the literal run up to each backslash instead of one character at a time. A JSON-style document full of escaped descriptions parses about a third faster.
