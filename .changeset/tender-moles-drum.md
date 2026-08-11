---
'@amritk/helpers': patch
---

Stop `foldNullable` from rewriting instance data. It descended into
`enum`/`const`/`default`/`examples`, so a schema-shaped `default` — ordinary in
a meta-schema or an OpenAPI document — had its own `nullable`/`type` folded:
the consumer got a different default value than the author wrote, with nothing
to say it changed. It now skips the data keywords, as the sibling walkers
already do.
