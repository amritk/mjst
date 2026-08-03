---
'@amritk/generate-validators': minor
'@amritk/generate-parsers': minor
'@amritk/helpers': minor
'@amritk/runtime-validators': patch
---

Take documents you already loaded, so a `$ref` to another document generates

**On the official JSON Schema Test Suite: `generate-validators` 1238 → 1268 /
1281 (99.0%), `generate-parsers` 1222 → 1237 / 1281 (96.6%).**

Both generators gain a `schemas` option: documents you have already loaded, keyed
by the absolute URI a `$ref` names them by. It is the build-time counterpart of
`@amritk/runtime-validators`' `ValidateOptions.schemas`, and it keeps the same
promise — nothing is fetched, you cannot pass a URL, only a document. What changes
is that "we do no I/O" no longer also means "we cannot be told".

A cross-document `$ref` was the single largest gap in both packages, and it is
gone. `refRemote.json` passes in full; so do the `dynamicRef.json` groups that
reach `tree.json` and `extendible-dynamic-ref.json`, and — with the dialect
metaschema registered — `defs.json` and `ref.json`'s "remote ref, containing refs
itself".

Each registered document becomes a resource of the document being generated: its
`$id`, its `$anchor`s and `$dynamicAnchor`s and its own embedded resources all
resolve, a `$ref` from one registered document into another resolves, and every
definition reached gets a file, a type and a validator/parser by the ordinary
rules. A document with no `$id` resolves its relative `$ref`s against the URI it
was registered under; one whose `$id` disagrees answers to both. Registering more
than the schema uses costs nothing — only the documents actually reached are
emitted — and a `$ref` to a URI nobody registered still stops the build with a
message naming the ref.

The mechanism is one pass, not a second addressing mode. `@amritk/helpers` gains
`graftExternalSchemas`, which embeds the registered documents into the root before
the `$id` pass, and `pruneExternalSchemas`, which drops the unreferenced ones once
the refs are pointers and reachability is finally knowable. Everything downstream —
the ref-graph walk, the naming, the emitted import graph — keeps working on a
single document and needed no change. `walkRefGraph` carries the option and
memoizes per `(schema, schemas)` by identity.

**Fixed: a root schema with a union `type` dropped every sibling constraint.**
`{ type: ['object', 'boolean'], properties: {…}, required: [...] }` emitted the
type check and nothing else, so it accepted any object at all. The multi-type root
branch now emits the shared constraint checks the single-type and combinator
branches already did; they carry their own runtime-type guards, so a member of the
union a constraint does not apply to is still untouched. This is the shape the
2020-12 metaschema's own root is written in, which is how it went unnoticed — the
generated dialect validator accepted `{ type: 1 }` as a valid schema.

`@amritk/runtime-validators` is unchanged in behaviour; its conformance figures are
restated against the corpus that is actually vendored (1281 cases, not 1299 — the
README's count never matched, and upstream's `content.json` is not among the
vendored files). The suite's `remotes/` loader moves to the shared fixtures
bookkeeping so all four conformance suites use one walk.
