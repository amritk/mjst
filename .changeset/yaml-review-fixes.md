---
"@amritk/yaml": minor
---

Fix a crash, a slowdown, and several misreadings in the YAML parser.

- `parseDocument` and `parseAllDocuments` no longer throw a `RangeError` on a long chain of compact explicit keys (`? ? ? … a`). The chain now counts against the nesting limit and reports `DEPTH_LIMIT`. Chains under the limit parse in linear time; 900 levels used to take about 100ms.
- Node properties in front of a flow collection or quoted scalar are no longer read as a block mapping. `\t&x {a: b}` no longer reports `TAB_INDENT`, and `--- &x {a: b}`, `--- &x "a: b"` and `--- !!omap [a: 1]` no longer report `UNEXPECTED_CONTENT`.
- Properties at the start of a compact mapping on a `?` or `:` line are now read as properties. `? a\n: &x b: c` used to report `BAD_SCALAR_START` and key the entry `"&x b"`. It now gives `{ a: { b: c } }` with `b` anchored, the same way the package reads properties at the start of a line.
- **Behaviour change:** `BAD_MERGE` now reports a `<<` merge of a `!!set` or an `!!omap`. These project to a `Set` or a `Map`, so there is nothing to merge. Before, the merge silently added no keys. A merge that goes through a chain of aliases no longer reports a false `BAD_MERGE`.
- **Behaviour change:** `!!timestamp` now accepts the end-of-day time `24:00:00`, which becomes midnight of the next day. It rejects a zone offset outside 00–23 hours or 00–59 minutes, such as `+99:99`.
- **Behaviour change:** a `!!binary` mapping key is keyed by its base64 text again (`AQID`). The bytes had been stringified (`"1,2,3"`), which collided with a real `"1,2,3"` key.
- `nodeAtPath` now sees pairs replaced or keys renamed in place in mappings of 16 or more pairs, the same as in smaller mappings.
- `parseDocument` no longer warns `MULTIPLE_DOCUMENTS` when the rest of the stream is empty documents only (`a: 1\n...\n---\n`).
- A `BAD_TAG_VALUE` warning on an empty tagged node (`a: !!bool`) now covers the tag, instead of an empty span.
- **Behaviour change:** a tab before a compact `?` key (`- \t? a`, `: \t? b`) now reports `TAB_INDENT`, as a tab before `- ` already did.
- **Behaviour change:** an indented `%` line is document content, not a directive. It now reports `BAD_SCALAR_START` instead of being dropped as an unknown directive.
