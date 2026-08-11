---
'@amritk/generate-parsers': patch
---

Test for `if`/`then`/`else` with `Object.hasOwn` rather than `in`, two lines
after the same function stopped enumerating name-keyed maps with `for…in` for
exactly that reason: `in` walks the prototype chain, so a polluted
`Object.prototype.if` had the walk descend into an inherited value and register
an import for a definition the document never declared.
