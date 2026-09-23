---
"@amritk/lint": patch
---

Fix findings pointing at the wrong place in two cases.

- Under an all-digit key such as a `"200"` response, a finding's path spells the key as the number `200`. Neither the YAML nor the JSON source map found a number segment under a map, so the finding's range was the whole enclosing map. Both now find the key.
- In YAML, a dotted key and the nested path with the same dots (`a.b: 1` beside `a: { b: 2 }`) shared one index entry, so a finding on one was reported at the other.
