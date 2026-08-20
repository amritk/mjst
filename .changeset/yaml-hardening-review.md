---
'@amritk/yaml': patch
---

Close four ways a document could hang, crash, or mis-report the parser.

- **A mapping key built from aliases no longer expands without bound.**
  Duplicate-key tracking renders every key it sees, and an alias is re-expanded
  wherever it appears — so a key naming aliases to collections that name more
  aliases grew exponentially, and a 613-byte document hung `parseDocument`
  outright. Key rendering now works to a budget: a real key is never affected, a
  runaway one is cut short with `…`. This also bounds `keyText` on a hand-built
  cyclic tree, which looped forever.
- **Folding a scalar is linear again.** Trailing whitespace was trimmed with
  `/[ \t]+$/`, which restarts at every index and re-walks the run — quadratic, so
  a scalar holding an 80 KB run of interior spaces took ten seconds.
- **An unterminated double-quoted scalar ending in `\` kept its span inside the
  source.** The escape scan stepped over two characters when only one was left,
  putting the scalar's `end` — and every enclosing node's — one past the input.
- **`parseAllDocuments` no longer throws on a stream with very many trailing
  problems.** They were moved onto the last document with `push(...list)`, which
  V8 rejects past ~125,000 arguments.

Also: `pendingAnchors` is cleared per document along with the rest of anchor
scope (hygiene — no input reaches a misreport through it), and a `!!set` no
longer builds the plain object it immediately discards.
