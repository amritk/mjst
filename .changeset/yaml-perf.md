---
"@amritk/yaml": patch
---

Faster path lookups and block scalar scanning. `nodeAtPath` now indexes mappings with 16 or more keys on first lookup (held weakly, rebuilt if the mapping's item count changes), so resolving every path of a large OpenAPI document is about 12x faster; results are unchanged, including duplicate keys resolving to the last pair. Block scalar lines in documents without `\r` are now found with a native `indexOf` search. Parsed values and positions are unchanged.
