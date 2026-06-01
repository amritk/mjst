---
"@amritk/yaml": minor
---

Add three parser features that fit the existing single-pass design without a
hot-path cost:

- **Core-schema `!!` tags** — `!!str`, `!!int`, `!!float`, `!!bool`, and `!!null`
  now coerce scalar values during `toJS()` (so `!!str 123` is the string
  `"123"`). The coercion lives in the lazy projection and is gated on a scalar
  actually carrying a tag, so the tree-building path is untouched. Unknown/custom
  tags still pass through with their value unchanged and the tag left on the node.
- **Multi-document streams** — new `parseAllDocuments(source, options?)` returns
  one document per `---`-separated body, each with its own anchors and problem
  lists. `parseDocument` still reads only the first document. The single-document
  path is unchanged; the stream loop only engages once a real boundary appears.
- **Explicit `? key` / `: value` mapping entries** — including block and flow
  keys, mixed with implicit entries. Detection is a single gated branch per
  mapping entry, so ordinary `key: value` maps pay nothing measurable.

Tab (non-space) indentation remains out of scope: it would add a comparison to
the innermost scanning loop and is forbidden by YAML 1.2.
