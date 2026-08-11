---
'@amritk/resolve-refs': minor
---

Close two gaps in the previous round's keep-the-node fix.

A `$ref` with **no fragment** into a document that never loaded still resolved:
a refused or unreadable document is held as a `{}` placeholder, and a
fragment-less pointer into `{}` finds `{}` — an empty schema, which accepts
anything. So `allOf: [{ $ref: '../outside.json' }]` became `allOf: [{}]` and a
ref to an SSRF-refused host became `{}`, replacing a constraint with a hole
that validates everything. Refs into a document that did not load are now kept
whether or not they carry a fragment.

`rebaseKeptRef` recognized only `http(s)` as already-absolute, so a kept
`urn:example:common#/$defs/Q` was treated as a relative path and rewritten to
`./sub/urn:example:common#/$defs/Q`. Any ref carrying a scheme is now left
alone (two or more characters before the colon, so a Windows drive letter is
not mistaken for one).
