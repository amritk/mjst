---
'@amritk/yaml': minor
---

Read the block shapes that were folding structure into strings

Nineteen more YAML test suite cases — 365/402 to **384/402 (95.5%)**. Every one
of them was a document whose structure the parser flattened into text or
orphaned entirely, and none of them produced a diagnostic saying so.

**Node properties written on a mapping key now apply to the key.** `&a a: b`
anchors the scalar `a`, so `*a` is the string `"a"`; before, the anchor stayed
inside the key's text and every alias to it reported `UNRESOLVED_ALIAS` and
projected to nothing. The same for tags — `!!str 23: v` keyed the mapping by the
literal `"!!str 23"` rather than by `"23"`. Anchor names that hold a `:` work
too (`&a: key: value` anchors `key` as `a:`), which needs the properties scanned
before the key separator is looked for, not after. Properties on a line of their
own above the mapping still describe the mapping. Reaching this costs one
character comparison per mapping entry — the scan itself only runs for a key
that is actually annotated.

**A `: ` inside a plain scalar is reported** (`BAD_SCALAR_CONTENT`). The spec
ends a plain scalar there, so `a: b: c: d` is an error and not the string
`"b: c: d"`; so is a continuation line that reads as a mapping entry, which is
what a mis-indented `k1: v1` / `⟨space⟩k2: v2` is. The scan is an `indexOf`, so
a scalar with no colon in it — nearly all of them — pays one native pass that
finds nothing. Quoted, block, and flow scalars are unaffected.

**Block collections may open on an explicit entry's introducer line.** `? a` /
`: - one` is a sequence whose first entry shares the `:` line, and
`? earth: blue` a mapping whose first entry shares the `?` line; both folded
into the value as text. Their remaining entries align under that first one, not
under the introducer. The mirror-image shape after an *implicit* key
(`key: - a`) is invalid YAML and is now reported rather than folded. Relatedly,
a `? ` introducer is settled by the first two characters, so it outranks any
`: ` further along the line — testing the colon first read `? earth: blue` as a
key called `? earth`.

**Indentation is measured against the parent, not against the node.** The
parser treated "the parent's column" as one less than the column the node
started at, which is only true when a node begins exactly one column in. When it
did not, documents were cut short: a plain scalar stopped at the first
continuation line that stepped back (`a:` / `⟨2 spaces⟩foo` / `⟨1 space⟩bar`
dropped `bar`, and a sequence entry that wrapped was split into two entries), a
zero-indented sequence introduced by a tag or an anchor was orphaned and
reported as stray content (`sequence: !!seq` over a `- entry` list, `seq:` /
`⟨1 space⟩&anchor` over one), and a block scalar counted its indentation
indicator from the wrong column. The document root still measures against -1, so
`--- |2` is unchanged.

The `parseAllDocuments` / `parseDocument` API, `toJS()` projection, and every
node's `[start, end)` span are unchanged, and the parser's throughput is
unchanged on all three benchmark fixtures.
