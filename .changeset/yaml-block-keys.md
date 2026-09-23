---
"@amritk/yaml": minor
---

Tighten block-mapping keys and node properties.

Newly reported errors (these documents used to parse silently):

- Text between a quoted, alias, or flow-collection key and its `:` (`"a"b: 1`, `"a" &x : 1`, `"a" !!str : 1`) is now `UNEXPECTED_CONTENT`. It used to be dropped, losing the anchor or tag it held.
- Malformed anchor and alias names report the new `BAD_ANCHOR` code: an empty name (`a: & x`, `- &`, a lone `*`), or, in block context, an anchor name running into a flow indicator (`a: &x{b: 1}`, `&x,y`). The name now ends at the indicator, so `a: &x{b: 1}` projects to `{ a: { b: 1 } }` instead of `{ a: '1}' }`. An alias name now also ends at `[` and `{`. A bare `*` reports `BAD_ANCHOR` in place of `UNRESOLVED_ALIAS`.
- Node properties written before a `?` on its line (`&x ? a`) are now `BAD_PROPERTY`.

Fixed false errors on valid documents:

- Repeated plain `<<` merge keys in one mapping (`<<: *a` / `<<: *b`) are no longer reported as `DUPLICATE_KEY` while `merge` is on. A quoted `"<<"` stays an ordinary key, and so does `<<` with `merge: false`.
- A tab before a comment after a block indicator (`- \t#k: x`) is no longer reported as `TAB_INDENT`.
