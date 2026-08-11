---
'@amritk/generate-markdown': patch
---

Add `dependencies` to the schema-map keywords, matching the three sibling
copies. Its keys are trigger property names, so an entry named `default` was
read as the data keyword and copied through unresolved — documenting a raw
`{"$ref": …}` instead of the schema it names.
