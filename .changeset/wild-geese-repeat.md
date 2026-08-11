---
'@amritk/resolve-refs': patch
---

Rename a hoisted cycle target on every node that references it. The rewrite
tracked the nodes the CYCLE branch built, but the annotation-only-sibling path
(an OpenAPI Reference Object — `$ref` beside a `description`) is the one place
that *copies* a resolved node instead of placing it. The copy inherited the
provisional `#/$defs/<name>` string without the registration, so a rename fixed
the original and left the copy pointing at whichever definition kept the old
name — one that exists and resolves cleanly, which is the worst shape a wrong
answer can take.

`detach` also now records a preserved class instance in its identity map, so
the same `Date` reached from two value positions still comes back as one
object, as the surrounding copy documents.
