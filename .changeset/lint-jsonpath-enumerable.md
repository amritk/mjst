---
'@amritk/lint': patch
---

Make the JSONPath engine agree with itself about what a node's members are.

A node's members are its own **enumerable** string keys — what a JSON or YAML
parser produces, and what every walk in the engine (`$..`, `$.*`, filters, and
the descent shared across a ruleset's paths) enumerates. Naming a key directly
used a plain own-property check instead, so a non-enumerable own property was
addressable by name but invisible to every walk. Same expression, different
answers: `query(data, '$..secret')` found it, while the batched `queryMany` —
which seeds from one shared descent — did not. Filter member reads (`@.secret`)
had the same split.

Only reachable when a caller hands the linter a hand-built object rather than a
parsed document, and there is no measurable cost to the check. Inherited
properties stay invisible either way.
