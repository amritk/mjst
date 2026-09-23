---
"@amritk/validation": patch
---

Fix generated parsers that did not compile when a union of `$ref` branches had a branch with a `$ref` property. The coercing parser scores each branch by reading its target's properties, and for a `$ref` property it emitted a call to that type's shape validator, which the scoring file never imported because imports are collected from its own schema. Such a property now counts toward the score by its presence alone. On the OpenAI API schema this removes 158 `Cannot find name` errors from the generated parsers.
