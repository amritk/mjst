---
'@amritk/asyncapi': patch
---

Read an AsyncAPI 3.0 Multi Format Schema Object the way the spec does.

`unwrapMultiFormat` required both `schemaFormat` and `schema` to be present, but
`schemaFormat` is optional on the wrapper and defaults to the AsyncAPI dialect —
the 3.0 meta-schema decides on `schema` alone. A payload written as
`{ schema: { ... } }` was therefore read as a schema whose only keyword was one
no dialect defines, and the message generated an empty type. A node with a
`schemaFormat` but no `schema` is still a plain Schema Object, so nothing that
worked before changes.
