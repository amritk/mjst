---
'@amritk/yaml': minor
---

Add opt-in comment retention, and tell a recursive alias from a missing anchor.

**`keepComments`.** Comments were skipped and unrecoverable — there was no way to
read one, which is what stops a linter from honoring an inline
`# …-disable-next-line` suppression or writing a rule about documentation
comments. `parseDocument(src, { keepComments: true })` now fills
`doc.comments` with every comment in source order, each carrying its exact
`[start, end)` span and its text.

The value is that **only the parser knows which `#` are comments**: inside a
quoted scalar, a block scalar, or a plain scalar a `#` is content, so
`a: "not # a comment"` and `a: foo#bar` hold none, and no scan of the raw text
tells the difference reliably. Comments on `---`/`...` marker lines and directive
lines are included, and each document of a stream gets its own list.

It is a flat list rather than a `comment` field per node, deliberately: which node
a comment belongs to is a policy call (the line above a key usually introduces it,
the one trailing the previous line usually does not), and a parser that guesses
imposes its guess on every consumer. The spans pair against any node's
`start`/`end`, so callers keep that decision.

Off by default, so parsing to data does not pay for it. The cost when off is one
boolean test per line plus four fields on the parser's state object: CI's
benchmark gate measures between -1.0% and -4.5% across the six yaml cases, all
inside its ±5% noise band but consistently negative, so read it as a low
single-digit cost rather than as free.

Checked against `yaml`'s CST tokenizer across the vendored OpenAPI fixtures and
~9k fuzzed documents that both parsers accept, with no divergence.

**`RECURSIVE_ALIAS`.** An alias inside the node its own anchor names —
`&a [1, *a]` — was reported as `UNRESOLVED_ALIAS`, whose message says the anchor
does not exist. It does; the node is simply still being built. Recursive
structures stay unsupported (a cyclic value is not the plain tree `toJS`
promises), but the diagnostic now says which of the two problems it is. A
genuinely missing anchor still reports `UNRESOLVED_ALIAS`.
