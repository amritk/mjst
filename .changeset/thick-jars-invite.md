---
'@amritk/yaml': patch
---

Stop allocating a `Set` per mapping to track duplicate keys

Duplicate-key detection cost 11–25% of parse time, and the cost scaled with the
number of mappings rather than document size. Both mapping parsers allocated a
`Set` as soon as a map had a second key, and real documents are overwhelmingly
made of tiny maps — `openai.yaml` (2.8 MB) has 13717 mappings averaging 2.7 keys
each, so parsing it allocated 9214 `Set`s, 99.3% of them to deduplicate eight
keys or fewer.

A `Set` is the right structure asymptotically and the wrong one at three keys.
Below a threshold the parser now scans the pairs it has already collected, which
allocates nothing; past it, it builds the `Set` once and hashes from there.
Throughput improves 4–7% on real-world OpenAPI specs and ~27% on documents dense
with small flow mappings such as `{ type: string, format: date }`.

Behavior is unchanged: reported errors are byte-identical, complex (map/seq)
keys are still skipped rather than collapsed into one bucket, and `uniqueKeys`
still turns the check off. The tracking logic had been duplicated verbatim
between the block and flow mapping parsers and is now a single shared helper.
