---
'@amritk/helpers': major
'@amritk/generate-parsers': major
'@amritk/generate-validators': major
'@amritk/generate-examples': major
---

Fix `$ref`-graph naming and reference resolution, and stop degrading silently.

Generation now fails loudly instead of writing output that cannot work:

- Two definitions that reduce to one filename (`Pet`/`pet`) or one type name
  (`foo-bar`/`foo.bar`/`fooBar` all become `FooBar`) are an error. The filename
  case used to drop one definition and give every reference to it the other
  one's shape; the type-name case emitted both files and left the importer with
  two `import { FooBar }` lines that do not parse.
- An unresolvable `$ref` is an error. It used to warn while the generators still
  emitted the type name and the parser/validator call for a file that was never
  written.
- A `$dynamicRef` with no `$dynamicAnchor` to bind to is an error. Leaving it in
  place made the type generator name the type after the anchor, so the canonical
  recursive-tree idiom (`$dynamicAnchor: "node"`) produced a reference to the
  DOM's `Node` interface — a clean compile with the wrong type.
- A document that relies on `$id` base-URI scoping is rejected rather than
  resolving its inner fragments against the document root and silently selecting
  a different definition.
- Every recursive schema walker enforces a nesting cap and reports it by name
  instead of dying with a bare stack-overflow.

And several things that were broken now work:

- Non-ASCII definition names (CJK, Cyrillic, accented) keep their characters
  instead of collapsing onto the single type name `_`, and the generated
  `index.ts` barrel re-exports them correctly.
- A root-level `$dynamicAnchor` is generated as the root's own file, so the
  2020-12 recursive-tree idiom produces a real self-referencing type.
- A plain `$anchor` ref (`$ref: "#named"`) resolves, instead of producing the
  unloadable import specifier `'./#named.ts'`.
- Derived filenames are normalized: no more `.ts`, `...ts`, `http:--x.ts`, or
  characters Windows and ESM specifiers reject. `$ref: "#/__proto__"` no longer
  resolves to `Object.prototype`.
- Generated readers guard `Object.prototype` member names (`constructor`,
  `toString`, `__proto__`, …) with `Object.hasOwn`, so a schema with a
  `constructor` property no longer fails its own shape check for every valid
  object, and the parser no longer fabricates a `__proto__` key.
- `x-mjst` `instanceOf` is allow-listed to the classes the generators support,
  so an arbitrary identifier is warned about and ignored instead of being
  emitted verbatim into the output.
