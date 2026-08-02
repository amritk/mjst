---
'@amritk/generate-parsers': major
'@amritk/helpers': minor
---

Resolve `$ref` against `$id` as a base URI in the ref graph

A `$ref` written against an enclosing `$id` — a relative URI (`list`,
`folderInteger.json`), an absolute one, or a URN — used to either stop generation
or, worse, find *a* definition and generate against it, so the emitted parser
enforced a schema its author did not write. On the official JSON Schema Test
Suite, strict-parser generation goes from 1180/1299 to **1222 / 1299 (94.1%)**;
all 29 of the resolve-to-the-wrong-definition cases became right rather than
refused.

Three new pieces in `@amritk/helpers`, deliberately free of any parser or
validator concepts:

- **`build-resource-registry`** — one walk producing the document's embedded
  resources, anchors and dynamic anchors, each `$id` composed against the base of
  its parent. Keyed by JSON Pointer, because that is the currency the rest of the
  package already deals in — a registry hit turns straight into a `$ref` string, a
  filename, or a type name. Returns `null` for a document with no `$id`, which is
  the fast-path switch, and is memoized per document.
- **`resolve-scoped-ref`** — one call covering relative, absolute, absolute-path,
  URN, pointer-into-resource and anchor-in-resource forms, plus the plain
  `#/$defs/x` that under an enclosing `$id` means *that resource's* `$defs`.
- **`normalize-ref-scopes`** — rewrites every `$ref`/`$dynamicRef` to a
  document-root pointer. This is the leverage: everything downstream already
  resolves refs by string against the root, so one normalization makes ref
  resolution, type naming, the import graph and the strict matcher correct at once,
  none of them needing base-URI awareness of their own.

It is wired into `walkRefGraph`, so `@amritk/generate-validators` and
`@amritk/generate-examples` inherit it.

`assertIdScopes` keeps its name and signature but changes meaning: it no longer
refuses any document with nested `$id` scoping, only the residue base-URI
resolution cannot place — a fragment ref inside an embedded resource that declares
its own targets and names none of them. That preserves the property worth having:
never silently pick the outer definition.

`@amritk/generate-parsers` additionally follows the spec on `contains` next to
`unevaluatedItems`: only the items `contains` matched are evaluated, not the whole
array. That is what `@amritk/runtime-validators` does, so the two stop disagreeing
about the same schema. Ajv marks the whole array, so the single fuzz fragment
pairing those keywords leaves the Ajv-oracle corpus (with the reason recorded next
to it) and unit tests plus the conformance suite cover it instead; every other
`contains` and `unevaluated*` fragment keeps fuzzing.
