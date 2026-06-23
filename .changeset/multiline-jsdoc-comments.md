---
'@amritk/helpers': patch
---

Render multi-line schema descriptions as proper JSDoc blocks in generated
types. Each line now gets an asterisk prefix and multi-line property comments
expand onto their own lines, instead of leaving continuation lines unprefixed.
