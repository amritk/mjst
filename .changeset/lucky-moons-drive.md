---
'@amritk/runtime-validators': minor
---

Add `customFormats`, for format checkers of your own.

`formats` was an allow-list over the built-ins and nothing else, so a schema
saying `format: 'phone'` could not be enforced at all. `customFormats` takes a
`RegExp` or a predicate for a string format, and `{ type: 'number', validate }`
for one over numbers. Registering a checker is the opt-in, so a custom format
does not additionally have to be named in `formats`; a definition also replaces a
built-in of the same name, which is how to tighten `email` or loosen `uri`
without forking the package.
