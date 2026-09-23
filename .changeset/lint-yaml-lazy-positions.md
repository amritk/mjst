---
"@amritk/lint": minor
"@amritk/mjst": minor
---

Resolve YAML finding positions on demand instead of indexing every node up front.

`parseYaml` used to walk the whole document after parsing to record a range for every path, which cost more than the parse itself on a large spec (on OpenAI's 2.8 MB OpenAPI document, lint's YAML parse drops from ~110 ms to ~40 ms, and a full `lintDocument` run with the OpenAPI ruleset from ~250 ms to ~140 ms). A lookup now walks from the root along the requested path and returns the same range the index did for every path — merged keys, merge lists, aliases, duplicate keys, multi-document streams, and the `closest` fallback included. Repeated candidates reached through aliased duplicate keys are folded and merged-key answers are cached, so a lookup stays linear in the document even for hostile alias and merge shapes, and a lookup that exhausts its work budget falls back to following the value `toJS` keeps rather than an unrelated shadowed node.

One deliberate change: a key brought in by `<<` now resolves to the value `toJS` takes it from. When a merge source itself merges (`s: &s {<<: *b, a: 1}` merged into `m`), its own `a` wins, as it does in the data; the index used to point at `b`'s `a`. A duplicated key inside a merge source likewise resolves to its last occurrence.

The opt-in `incompatibleValues` check now runs its own linear scan. A non-finite value reached through several aliases is reported once instead of once per alias path, a merged non-finite value that lands in the data behind a duplicate key, which the old walk skipped, is now reported, and merged values follow the same `toJS` rule as positions (so `{<<: {<<: *b, a: .inf}}` reports the `.inf` the data holds, and a value the source overrides is no longer reported).
