---
"@amritk/generate-examples": patch
---

Fix derived number examples that broke their own bounds. The tighter of `maximum` and `exclusiveMaximum` now wins (`exclusiveMaximum` was ignored whenever `maximum` was present), an exclusive bound inside a range narrower than one unit is cleared by half the gap rather than a fixed 0.5, fractional bounds on an integer round inward, and an integer with a fractional `multipleOf` steps by the smallest whole multiple (`2.5` → `5`).
