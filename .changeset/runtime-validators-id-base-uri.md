---
'@amritk/runtime-validators': minor
---

Resolve `$ref` against `$id` as a base URI, and give `$dynamicRef` a real dynamic
scope

Measured against the official JSON Schema Test Suite, the interpreter goes from
1183/1299 to **1250/1299 (96.2%)**. Sixty-seven cases, one cause: a `$ref` written
against an `$id` — relative (`"list"`), absolute
(`"http://example.com/b/d.json"`), or a URN — had nothing to resolve against and
threw, even when the resource it named sat *inside the same document*.

The document is now walked once into a registry of its embedded resources: each
`$id` composed against the base of its parent, and each resource's `$anchor`s and
`$dynamicAnchor`s registered under it. A ref resolves against the base in scope at
the referring node — relative, absolute, URN, absolute-path, pointer-into-resource
and anchor-in-resource forms all work — and `$dynamicRef` implements bookending
properly: it goes dynamic only when static resolution already lands on a
`$dynamicAnchor` of that name, then takes the outermost resource in the dynamic
scope declaring it.

Two behavior changes fall out of that, both spec-correct and both confined to
documents that declare an `$id`:

- A `#/pointer` inside an `$id` scope resolves within that resource rather than at
  the document root. A scoped ref that names nothing in its own resource still
  falls back to the document-global lookup, so a bundled schema that worked before
  works unchanged — the new path can only *add* an answer.
- `contains` publishes the indices it matched rather than sweeping the whole
  array, so an adjacent `unevaluatedItems` sees the right set. This is where the
  spec and Ajv disagree; the suite agrees with the spec, and so do we. The pair is
  excluded from the Ajv differential corpus and covered by unit tests plus the
  suite instead.

Cost is kept off the common path: the registry is `null` for a document with no
`$id` at all, the `$id` scan is fused into the pattern-screening walk that already
happened, and resolutions are memoized per validator. Eval-free, synchronous,
zero-dependency and no-I/O all hold.

What remains unimplemented is now one decision rather than two: this package does
no I/O, so a `$ref` naming *another document* (and `$vocabulary`, which means
fetching a metaschema) still throws. Bundle with `@amritk/resolve-refs` first.
