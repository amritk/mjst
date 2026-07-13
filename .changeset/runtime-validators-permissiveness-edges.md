---
"@amritk/runtime-validators": minor
---

Close three silent-permissiveness edges:

- An unknown `type` value (`type: "strng"`) now throws when consulted instead
  of matching everything — a typo'd type is a schema error, and silently
  accepting all data disabled the constraint. Same loud contract as an
  unresolvable `$ref`.
- `$recursiveRef` / `$recursiveAnchor` (draft 2019-09) are now supported,
  binding to the document's `$recursiveAnchor: true` subschema (or the root),
  instead of being silently ignored.
- `idn-hostname` joins the built-in opt-in formats; previously enabling it
  validated nothing.
