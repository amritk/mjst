---
"@amritk/lint": patch
---

Fix a JSON finding pointing at the whole document when its key is repeated after a property whose value failed to parse (`{"a": , "a": 1}`). The lookup stopped at the broken property instead of the later one the parsed data holds; it now skips a property with no value, as `jsonc-parser`'s lookup did.
