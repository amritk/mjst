---
"@amritk/lint": patch
"@amritk/mjst": patch
---

Resolve YAML finding positions on demand instead of indexing every node up front.

`parseYaml` used to walk the whole document after parsing to record a range for every path, which cost more than the parse itself on a large spec (on OpenAI's 2.8 MB OpenAPI document, lint's YAML parse drops from ~110 ms to ~40 ms, and a full `lintDocument` run with the OpenAPI ruleset from ~250 ms to ~140 ms). A lookup now walks from the root along the requested path and returns the same range the index did for every path — merged keys, merge lists, aliases, duplicate keys, multi-document streams, and the `closest` fallback included.

The opt-in `incompatibleValues` check now runs its own linear scan. A non-finite value reached through several aliases is reported once instead of once per alias path, and a merged non-finite value that lands in the data behind a duplicate key, which the old walk skipped, is now reported.
