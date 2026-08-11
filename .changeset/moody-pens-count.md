---
'@amritk/helpers': patch
---

Restore `rewriteRootRefs`' deep copy, and pin the keyword sets with a test.

Skipping instance data left the caller's own object in the returned tree, so a
later stage mutating a `default`/`enum` value would write through to the input
document and to every other emitted node — the function documents a fresh tree.
Those subtrees are copied now, just not rewritten.

`DATA_KEYWORDS` and `SCHEMA_MAPS` are restated in four other modules, because
the packages that hold them take no `@amritk/*` dependency by design. Every
copy has drifted at least once, each time producing the same class of bug — a
definition named `default` or `example` silently skipped, so an `$anchor` under
it never registered, a `pattern` under it was never screened, or a tuple inside
it was never normalized — and three review rounds found three of them one at a
time. A parity test now reads the five declarations and asserts they are equal,
so the next omission fails a test instead of surfacing as an unwalked subtree.
