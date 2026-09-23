---
"@amritk/yaml": minor
---

Fix how document markers and the stream head are read, and make `parseDocument` read the first document exactly as `parseAllDocuments` does.

- `---` and `...` are document markers only at column 0. Indented, they are ordinary text: ` ---` is now the string `"---"`, `--- a` followed by `  ...` is `"a ..."`, and an indented `---` after a root collection is reported as stray content instead of silently ending the document.
- A column-0 `---` that carries a node (`--- b: 2`) now ends a root mapping instead of being read as a key called `--- b`, and `parseDocument` warns `MULTIPLE_DOCUMENTS` when the next document is written on its `---` line.
- `parseDocument('---\n---\na: 1\n')` now returns the empty first document with a `MULTIPLE_DOCUMENTS` warning instead of the second document's contents.
- `parseDocument` now reports what `parseAllDocuments` already did for the first document: `UNEXPECTED_DIRECTIVE` for directives with no `---` after them and for a `%` line after `---` (which is now kept as content, `{ "%x": 1 }`, instead of being dropped), `UNEXPECTED_CONTENT` for content after a `...`, and it reads the document that follows a leading `...` instead of returning `null`.
- `--- - a` and `--- ? a` now report `UNEXPECTED_CONTENT`, like `--- a: 1` already did: a block collection cannot start on the `---` line.
- A tab used to indent a root block mapping or sequence (`\ta: 1`, `\t- a`, `---\n\ta: 1`) now reports `TAB_INDENT`. A tab before a root flow collection or scalar (`\t[a]`, `\t{}`, `\t'~'`) stays valid.

Documents that used to parse cleanly can now report these errors, and a few values change (indented markers are text, a `%` line after `---` is kept).
