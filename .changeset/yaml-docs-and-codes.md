---
"@amritk/yaml": minor
---

Type the diagnostic codes, fix `lineCounter` on a `NaN` offset, and bring the docs in line with the parser.

- **New `YamlErrorCode` type.** `YamlError.code` is now a union of every code the parser reports, instead of `string`, and the type is exported. A comparison against a misspelt code (`e.code === 'DUPLICATE_KEYS'`) now fails to typecheck. This can break code that builds its own `YamlError` objects with a code outside the union, or assigns an arbitrary `string` to `code`. Widen to `string` at that point if you need to.
- **`lineCounter(source).linePos(NaN)`** now returns `{ line: 1, col: 1 }` instead of `{ line: 1, col: NaN }`. `NaN` is clamped to the start, as a negative offset already was.
- **Docs.** The README's error table and AI.md now list every code under its real severity. `BAD_DIRECTIVE` and `DUPLICATE_DIRECTIVE` are errors for `%YAML` and warnings for `%TAG`. The docs now describe the current behaviour: strict tag coercion with `BAD_TAG_VALUE`, repeatable `<<` merge keys, bad escapes keeping their backslash, and column-0-only document markers. They also cover the `tag` / `anchor` fields on every node kind: a local tag keeps its `!`. The README's benchmark ratios now match its own tables, and its bundle-size note says which exports the probe imports.
