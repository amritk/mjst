---
"@amritk/lint": minor
---

Resolved rules no longer re-walk a `$ref` target once per route that reaches it. A dereferenced tree shares one object wherever a reference pointed at it, so a `$..` query used to visit it once per path, which grows exponentially on documents whose schemas reference each other in layers: a 150 KB spec took 340 ms to lint and a 1.9 MB one 1.1 s. The shared walk now enters each object once per walk state and key. Every route maps back to the same authored node, so findings are unchanged. Queries that can see the route (`@path` filters, `^` climbing past the shared object) keep the full walk.

What changes for a custom ruleset: a function on a resolved rule that branches on the part of `context.path` above its target, or a `{{path}}` message, now sees one route per shared node instead of every route — each of those routes was reported at the same location before. Without a source set, routes that lead back to different authored nodes (a node inlined by a cross-document ref, or a target merged into a ref's own `allOf`) are still walked and reported apart.
