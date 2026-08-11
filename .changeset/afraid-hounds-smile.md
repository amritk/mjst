---
'@amritk/runtime-validators': patch
---

Document why the `properties`/`required` presence check stays on its fast path.
Unlike the instance sweeps, that loop walks the schema's declared keys, so a
polluted `Object.prototype` only matters when a polluted name equals a declared
property — and paying for `Object.hasOwn` on every declared key of every object
to cover that is the wrong trade on the interpreter's hottest loop. The
boundary is now stated where the check is, so it reads as a decision rather
than an omission.
