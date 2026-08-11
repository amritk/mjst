---
'@amritk/helpers': patch
---

Stop the schema walkers from losing keys, rewriting instance data, and
disagreeing with each other.

**A property named `__proto__` no longer disappears.** Every walker here
rebuilds objects key by key, and on that one key `result[key] = value` is not
an assignment — it runs the prototype setter, so a declared property and all
its constraints vanished from the output while the rebuilt object started
inheriting the subschema's keys. The guard existed in one place; it is now a
shared `assignKey` used by every walker, and `foldNullable` no longer sweeps
with `for…in` either. In the draft-07 upgrade the same slip lost a *definition*
named `__proto__` while still rewriting the `$ref` to it, so the ref dangled
and the generators stopped the build.

**A definition or property named `default`, `example` or `examples` is a name,
not a keyword.** Every walker tested the data keywords by key name alone, which
conflated a schema node (where those are keywords holding instance data) with a
`properties`/`$defs`/`dependencies` map (where they are author-chosen names).
So an `$anchor` declared under `$defs.default` never registered and `$ref:
'#thing'` could not resolve; a `#/definitions/…` under a property named
`example` was left dangling; a schema-shaped `default` had its `nullable`
folded and a ref-shaped one had its literal rewritten; and a boolean inside a
`default` was expanded from `true` to `{}`. `schemaChildren` now yields each
child with the position it sits in, and all eight walkers go through it —
including the array rule they had split on.

**Lookups no longer resolve against `Object.prototype`.** `resolveRef` returned
`Object.prototype` for `__proto__` as though the document had declared it (and
`walkRefGraph` emitted a file for it); `$dynamicRef: "toString"` resolved to a
`Function` in place of the "unresolvable" error; `pruneExternalSchemas` read
`$ref` unguarded, so a polluted prototype made everything read as reached and
nothing was pruned.

**Pointer escaping agrees end to end.** `buildAnchorMap` and
`buildDynamicRefMap` each carried a private escaper that handled `~` and `/`
but not `%`, while the pointers they produce are `$ref` fragments that
`resolveRef` percent-decodes — so a definition named `a%2Fb` was looked up as
`a/b`. Both use the registry's escaper now, and `unescapeSegment` reverses the
`%` escape it adds. A parity test asserts the four hand-maintained copies of
the keyword sets stay equal, since each had drifted at least once.
