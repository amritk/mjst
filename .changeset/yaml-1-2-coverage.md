---
'@amritk/yaml': minor
'@amritk/lint': patch
---

Close the YAML 1.2 gaps that cost nothing on the hot path, and measure the rest
against the official test suite.

**Fixed — silent data loss**

- A collection used as an implicit mapping key (`[a, b]: value`, `{a: 1}: value`)
  discarded the mapping and every sibling entry, returning only the collection.
- An alias used as a mapping key (`*ref: value`) was keyed by the literal text
  `*ref` instead of the anchored value.
- An anchor on an empty node (`a: &anchor`) was never registered, so a later
  `*anchor` — which is legal, and resolves to null — dangled.
- Node properties written on their own line no longer swallow the node below
  them when it sits at the same indentation.
- A block scalar opened on a `- ` line measured its content against the item's
  column rather than the sequence's, dropping the scalar's body.

**Added — tag resolution**

`!<verbatim>` tags, `%TAG` handle declarations, and the non-specific `!` now
resolve. A local tag keeps its `!` on `node.tag` (`!custom`), so an application
tag sharing a core tag's name no longer coerces its value like the core one.

**Added — diagnostics**

`UNRESOLVED_ALIAS`, `UNEXPECTED_CONTENT` (trailing content after a node, and a
second root node with no `---`), `UNEXPECTED_COMMA` (empty flow entries),
`BAD_SCALAR_START` (reserved `@` / `` ` ``), `BAD_TAG`, and `UNKNOWN_TAG_HANDLE`.
Directive problems (`%YAML` version, duplicates, unknown directives) are reported
as warnings, which populates `doc.warnings` for the first time.

**Added — conformance harness**

`src/conformance.test.ts` runs the official YAML test suite: **293/402 cases
(72.9%)**, up from 251/402. Every remaining failure is listed with its reason, and
the test fails if a case moves in either direction, so the README's scope section
is now checked rather than asserted.

**Behavior changes** (pre-alpha; `@amritk/lint`'s path index is updated to match)

- `node.tag` for a local tag is now `!custom` rather than `custom`.
- An empty mapping key projects to `''` rather than `'null'`.
- A collection mapping key projects to its flow rendering (`'[ a, b ]'`) rather
  than `''`.

Parser throughput is unchanged. Measured in-process against the previous parser
across six document shapes — a tiny config, a 2 KB OpenAPI document, a 100 KB
document, a 400-key plain block mapping, a quoted-scalar mapping, and a 200-entry
block sequence — every shape lands within ±1% of the old parser, and the 100 KB
document is faster. Every check added here sits in a branch that was already
cold, reuses a character read the parser was already making, or was moved out of
a hot function so it does not affect what the JIT inlines.
