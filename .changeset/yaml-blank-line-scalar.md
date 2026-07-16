---
"@amritk/yaml": patch
---

Fix a plain scalar losing its type when a blank line follows it. A blank line before the next entry staged a continuation segment, forcing the multi-line code path, which returned the folded text verbatim instead of resolving it through the core schema — so `port: 8080\n\nhost: x` parsed `port` as the string `"8080"` (and `true`/`1.5`/`null` likewise became strings). The folded value is now resolved just like the single-line path; a genuinely multi-line plain scalar still folds to a string.
