---
'@amritk/generate-parsers': patch
---

Enumerate `properties` and `patternProperties` by own keys when collecting
imports. Those maps are keyed by author-chosen names, and a bare `for…in` walks
the prototype chain — so under a polluted `Object.prototype` the walk visited an
inherited key and could emit an import for a definition the document never
declared.
