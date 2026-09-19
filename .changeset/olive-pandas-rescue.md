---
'@amritk/helpers': patch
---

Fix a regression in 0.21.1 that dropped the JSDoc from required properties
inside an `anyOf`/`oneOf` branch.

A union branch is rendered against the schema composing it, so each key the
branch's `required` names is seeded with the composing schema's declaration —
or with `true`, "nothing said", when that schema does not declare it. The
branch's own `properties` were then folded in as `{ allOf: [seeded, own] }`.
That intersection is right about the type, but it carries no annotations of its
own, and the JSDoc above a property is read off exactly that node. So every
required property in a self-contained branch came out undocumented while the
optional properties beside it kept their comments, and nothing failed — the docs
just stopped being emitted.

The fold now carries the description (or `$comment`) forward, taking the more
specific fragment's first, and skips the wrapper entirely when one side is
`true` and says nothing to intersect. The same fold renders an `if`/`then` pair,
so a key both fragments declare keeps its docs too.

Branch properties are also emitted in the order the branch declares them again,
rather than required keys first.
