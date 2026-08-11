---
'@amritk/mjst': patch
---

Report a config option named after an `Object.prototype` member as unknown.

`validateConfig` indexed its known-options table directly, so a config
containing `"constructor"`, `"toString"` or `"valueOf"` found the prototype
member and type-checked the value against it — answering `expected undefined,
received string` instead of the unknown-option message that lists the real
options and makes the typo obvious.
