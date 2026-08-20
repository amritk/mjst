---
'@amritk/helpers': minor
---

Fix five correctness and robustness defects found in a review of the package.

- `resolveDynamicRefs` skipped the whole document when its only `$dynamicRef`
  sat under a property genuinely *named* `enum`, `const`, `default`, `example`
  or `examples`. The cheap pre-scan that decides whether to rewrite at all
  tested key names without tracking whether it was inside a name-to-schema map,
  so the ref survived into generation — where the type generator names the type
  after the anchor and, for the conventional anchor `node`, silently binds to
  the DOM's `Node` interface. The pre-scan now asks the same shared position
  rule the rewrite does.

- `generateTypeDefinition` and `mjst-extension` read schema keywords straight
  off the node, so a polluted `Object.prototype` was indistinguishable from an
  authored keyword: with `Object.prototype.additionalProperties` set, a bare
  `{ type: 'string' }` rendered as `{ [key: string]: number }`, and an inherited
  `if`/`then` pair recursed until the stack ran out. Both now read own
  properties only, matching what `schema-guards` already does for the keywords
  it guards.

- `graftExternalSchemas` and `pruneExternalSchemas` rebuilt `$defs` with plain
  assignment, so a definition named `__proto__` — including one the author
  wrote, and one derived from a registered URI ending in `__proto__.json` —
  ran the prototype setter instead of becoming a property: the definition
  disappeared while every reference to it stayed, and the map inherited the
  definition's own keywords. Both now use the package's `assignKey`.

- Six recursive walkers had no depth guard, so a pathologically nested document
  died with a bare `RangeError` instead of the message `MAX_SCHEMA_DEPTH`
  exists to produce — including on `walkRefGraph`, the package's main entry
  point. `assertSchemaDepth` now takes an optional limit, and the type renderer
  passes a lower one: it spends about five stack frames per schema level where
  the document walkers spend one, so at the shared cap the stack ran out first
  and the guard could never fire. Documents nesting deeper than 400 levels are
  now reported by name rather than crashing.

- `walkRefGraph` generated an output file for a definition referenced only from
  a `default` value, because the `$dynamicRef` pointer scan walked instance
  data. It now skips data positions, as its sibling scans already did.

Also: the `minLength: 1` fast paths in `string-length-check` are now
self-parenthesized, so every emitted expression can be negated with a bare `!`
the way `multiple-of-check` documents (`!x.length >= 1` parsed as
`(!x.length) >= 1` — a constant `false` that passed every string).
