---
'@amritk/yaml': minor
---

Report the syntax errors that were quietly changing what a document said

Twenty-nine more YAML test suite cases, every one of them in a branch that was
already cold — a block scalar header, a backslash, a `#`, a node property.

**A block scalar header was accepted whatever followed it.** `folded: > first
line` dropped `first line` and re-read the body below as the scalar; `|10` took
the `1` as an indentation indicator and threw the `0` away; `>#comment` read a
comment the spec does not allow there; and a repeated indicator (`|--`) silently
kept the last one. The header now ends where its indicators do, and anything
past it is a `BAD_BLOCK_HEADER`. A leading blank line indented deeper than the
block's first content line — which makes the block's own indentation ambiguous —
is a `BAD_INDENT`.

**A `\` escape the spec does not define passed through as the bare letter,** so
`"a\.b"` became `a.b` and `"it\'s"` became `it's`, each silently dropping a
character the document wrote. Undefined escapes are now `BAD_ESCAPE`; the value
is still produced, so nothing that parsed stops parsing.

**A `#` with no whitespace before it is not a comment.** `key: "value"# text`,
`[ a, b ]#text`, and `[ a, b,#text` each dropped the rest of the line as though
it were one (`BAD_COMMENT`). The mirror image is fixed too: a comment *does* end
a plain scalar, so `word1 # comment` followed by `word2` no longer folds `word2`
into the value — it is reported as content no node claims.

**An implicit key has to fit on one line.** A quoted key spanning lines
(`"a\nb": 1`), a flow collection used as a block key across lines (`[23\n]: 42`),
and a compact `[ key\n : value ]` sequence entry are now `BAD_IMPLICIT_KEY`. A
flow *mapping* may still write `{ "foo"\n: bar }` — the spec allows that one.

**Node properties are checked where they land.** An anchor or tag written on an
alias (`key: &b *a`) was dropped without a word, and two anchors reaching one
scalar kept only the second: both are now `BAD_PROPERTY`. A block sequence
opened on a properties line (`&anchor - entry`) read as the plain scalar
`"- entry"` and is now reported.

**Also:** a multi-line quoted scalar whose continuation lines do not clear their
parent's indentation is a `BAD_INDENT`; a `-` where a flow entry belongs (`[-]`)
is a `BAD_SCALAR_START`; and a `---`/`...` marker inside a flow collection, or
in the middle of a wrapped flow scalar, ends the document instead of being
absorbed into it.

New codes: `BAD_BLOCK_HEADER`, `BAD_COMMENT`, `BAD_ESCAPE`, `BAD_IMPLICIT_KEY`,
`BAD_INDENT`, `BAD_PROPERTY`.

Conformance against the official YAML test suite is **365/402 (90.8%)**, up from
336/402, with every remaining gap still listed and reasoned. Measured against
main with the ABBA bench harness over three full runs, every fixture is within
noise: the one cell that ever flagged — `large (data)`, at -8.9% — came from the
run sharing the machine with a test suite, and read -1.5% and +3.2% in the two
runs that had it to themselves.
