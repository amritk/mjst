---
'@amritk/api': patch
---

`staticContentType` reads its extension table as an own property.

A bare index returned an inherited `Object.prototype` member for a file whose
extension named one, and the result is not nullish, so the
`application/octet-stream` fallback never fired: `x.constructor` was served with
a `content-type` of the entire `Object` function source, and `x.__proto__` with
`[object Object]`. Only all-lowercase members were reachable (the extension is
lowercased first), which is why `constructor` and `__proto__` were the two that
got through.
