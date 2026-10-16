---
'@amritk/lint': minor
---

Faster on large documents, with the same findings and ranges.

- `lint`, `lintWithResult`, `lintDocument` and `lintDocumentWithResult` accept `{ data, text? }` as well as a string, and `createDocumentFromData(data, { text })` builds the same document for `createLinter(ruleset).run()`. The parse is skipped, so parser diagnostics (`duplicateKeys`, `incompatibleValues`, syntax errors) are not reported; `text` is only read to put `line:column` ranges on findings, lazily. Without `text` every range is the zero range. Plugins that rewrite the document need `text`.
- Valid JSON is parsed with `JSON.parse`, and positions are found by scanning the text for just the paths that carry findings. Invalid JSON still goes through the tree parser for its recovery and error positions. Objects in parsed JSON now have the ordinary prototype, as YAML documents always have. This can break a custom rule function or plugin that reads author-chosen keys off `document.data` without an own-key check: `'constructor' in node` or `node.toString` on a JSON document now finds the inherited member instead of `undefined`.
- Every rule with a `..` descent shares one walk of the document, wherever its descent starts (`$..x`, `$.paths.*..x`, `$.components.schemas..[?(...)]`), and subtrees no rule can reach are not walked.
- A filter that cannot be evaluated on a node no longer throws and catches internally, and a filter that can only match objects is not evaluated on scalars.
- New rule option `descent: 'schema'` keeps `..` out of `example`, `examples`, `default`, `const` and `enum` values (except where those words are names in a map such as `properties`, `responses` or AsyncAPI's `messageTraits`), so a schema rule no longer matches inside an example payload.
