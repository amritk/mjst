---
'@amritk/yaml': patch
---

Cap the alias-expansion budget, so padding a document cannot buy a bigger one.

The `toJS` guard against runaway alias expansion allowed `sourceLength * 100`
nodes with no ceiling, so harmless content in front of a bomb raised the bar it
had to clear. 2.7 MB of padding ahead of a 600-byte alias bomb bought a
279-million-node budget: the projection reached 3.5 GB of resident memory over
thirteen seconds before it threw, and ten times the padding is an
out-of-memory kill — the uncatchable crash this budget exists to prevent.

The allowance is now capped at twenty million nodes. Real documents are nowhere
near it (measured over the vendored OpenAPI specs, they run 0.03–0.1 nodes per
byte; the largest, 2.7 MB, materializes 81,537), and neither is a document that
legitimately leans on aliases.
