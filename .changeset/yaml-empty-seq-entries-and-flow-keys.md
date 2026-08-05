---
'@amritk/yaml': minor
---

Stop dropping sequence entries after a property-only entry, and parse flow
collections written as explicit or non-first mapping keys.

Two shapes lost data silently, both found by differential fuzzing against `yaml`
(eemeli) and `js-yaml`.

**A sequence entry holding only a tag or an anchor swallowed the entries after
it.** `- !!str` with nothing following it on the line is an entry whose value is
an empty (tagged) node, and the next `-` at the same column is its *sibling*.
The properties-with-no-inline-value path adopted that dash as nested content
instead, on the "a block sequence may sit at its mapping's own column" rule —
which is true for a mapping value and not for a sequence entry. `- !!str\n- a\n- b`
came back as the single item `[["a", "b"]]` rather than `["", "a", "b"]`, so
every entry after the first was both misplaced and one level too deep. The
allowance is now scoped to the mapping parents it was written for; content that
really is indented past the dash still nests as before.

**A flow collection whose text contains a `: ` was read as a block mapping.**
The lookahead that decides whether a line is a `key: value` entry honored quotes
but not flow collections, so it split at the collection's *own* separator:
`? {x: 1}` keyed the mapping by the plain scalar `{x` with the value `1}`, and
the same happened on the value side of an explicit entry (`? k` / `: {x: 1}`)
and on any block-mapping entry after the first (`a: 1` / `{x: 2}: v`). The value
side produced wrong data with no diagnostic at all. The scan now steps over a
leading flow collection before looking for the separator, and a flow collection
used as a key is parsed as a node rather than sliced as text — so it keys the
mapping by the same rendering an identical collection on a *first* entry has
always produced, and the nodes inside it keep their source positions.

Duplicate-key tracking now covers collection keys too. It skipped them on the
grounds that they had no stable text form, which stopped being true once
`keyText` learned to render them in flow style: `toJS` keys the projected object
by exactly that string, so two collection keys that render alike really do
collide and one value was overwritten with nothing reported. `{ [a, b]: 1, [a, b]: 2 }`
and a collection key duplicated through an alias to it are now reported like any
other duplicate. This is the breaking part of the change — documents with such a
key that previously parsed clean now carry a `DUPLICATE_KEY` error, and
`{ uniqueKeys: false }` accepts them as before. For the same reason `--- [a, b]: v`
now reports the block mapping it opens on the `---` line, which the old flow-blind
lookahead waved through; a bare `--- {a: 1}` is still fine.
