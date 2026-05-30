---
"@amritk/yaml": minor
---

Add `@amritk/yaml`: a tiny, dependency-free YAML parser with exact source
positions, built for diagnostics. Every node records its `[start, end)` source
range so a consumer can map any value back to an exact `line:column`. It parses
to data via `parse`, to a positioned tree via `parseDocument`, resolves a JSON
path to its node with `nodeAtPath`, and maps offsets to `line:column` with
`lineCounter`. Covers block and flow collections, all quoting styles, block
scalars with chomping, comments, anchors, aliases, and merge keys, with YAML 1.2
core-schema scalar resolution. Benchmarked ~20× faster than `yaml` for building
a source-mapped tree and ~7.6× smaller, with a differential test suite pinning
data output to `yaml` across full OpenAPI specs.
