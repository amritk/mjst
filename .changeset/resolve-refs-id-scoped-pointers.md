---
'@amritk/resolve-refs': patch
---

Resolve a `#/pointer` inside an `$id` scope against the resource that declares it

A fragment-only ref was hard-coded to resolve against the document root, so
`{ "$id": "…/base.json", "$defs": { "inner": … }, "properties": { "x": { "$ref": "#/$defs/inner" } } }`
nested inside a larger document reported "Cannot resolve internal `$ref`" — the
pointer names a definition of the *embedded resource*, not of the root. It now
looks in the resource named by the base URI in scope first, and falls back to the
document root only when the pointer matches nothing there. The fallback is what
keeps bundled documents working: a bundled OpenAPI file points at
`#/components/schemas/…` from inside an `$id` scope, and when both could match the
resource wins, which is the order the spec asks for.

That also settles pointer-form `$dynamicRef`s (`#/$defs/items`) inside an `$id`
scope: the spec says a `$dynamicRef` whose fragment is a pointer behaves exactly
like `$ref`, so resolving it against its enclosing resource is right by
construction.

On the `$ref` corpus of the official JSON Schema Test Suite the package is at
**160 / 170**. The corpus grew from 107 with `@amritk/runtime-validators`' `$id`
work — it is the reference-carrying cases the interpreter answers correctly, which
is the population where a resolution bug is visible at all. What is left is one
documented limit: a `$dynamicRef` binds at evaluation time to the outermost
`$dynamicAnchor` along the *dynamic* scope, so inlining it statically collapses it
to a single target and cannot be right in general.
