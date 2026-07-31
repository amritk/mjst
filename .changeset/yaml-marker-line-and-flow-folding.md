---
'@amritk/yaml': minor
---

Parse the node written on a `---` line, and stop flow scalars losing their type

Four silent-data-loss bugs, each in a branch that was already cold.

**A node written on the `---` line was discarded.** The document head skipped
the whole marker line, so `--- |` lost its block-scalar indicator and re-read
the body as a folded plain scalar (line breaks gone), `--- foo` lost the scalar
entirely, and a tag or anchor on the marker line never applied. The node is now
parsed and measured against column 0 rather than the column the marker pushed it
to, so `--- >` may hold content starting at column 0. A block *mapping* on the
marker line is invalid YAML and is now reported. This is also what makes
`--- !!set` / `--- !!omap` reach their `Set` / `Map` projections.

**A flow scalar that ended its line lost its core-schema type.** `{ a: 1, b: 2 }`
resolved `b` to the number `2`, but the same document wrapped —
`{ a: 1,\n  b: 2 }` — resolved it to the *string* `"2"`, because the multi-line
path folded the segments without resolving them. Every entry of a flow
collection written across lines was affected. Such a scalar also now ends at a
`:` or `#` that opens the next line, instead of folding it in — `{foo\n: bar}`
used to key the mapping by `"foo\n"`.

**Double-quoted folding ran before escapes were resolved,** so it could not tell
an escaped `\t` (content) from a literal trailing tab (padding), and it turned a
`\` line-continuation's break into a space the `\` then absorbed. Escapes are now
resolved per line first, and folding strips only whitespace the document wrote
literally.

**A block-folded scalar treated only a space as "more indented",** so a break
beside a tab-led line folded to a space and the blank line next to it was lost.

Also: an unterminated quoted scalar now stops at a `---`/`...` marker instead of
swallowing every document after it; `!!str` over a wrapped plain scalar reads the
folded text rather than un-folding it; and the stream-level directive rules are
enforced — a directive needs a `...` before it and a `---` after it, its version
must parse, a second `%YAML` is an error rather than a warning, and a tag may not
hold a flow indicator. New code: `UNEXPECTED_DIRECTIVE`.

Conformance against the official YAML test suite is **336/402 (83.6%)**, up from
293/402, with every remaining gap still listed and reasoned.
