---
"@amritk/api": patch
---

Fix four HTTP-layer correctness bugs surfaced by a review of `@amritk/api`.

- **`multipartBodySerializer`** — a repeated field carrying files (the
  multi-file upload case, `{ files: [file1, file2] }`) was `String`-coerced to
  `"[object File]"` per item, silently dropping the uploads. `Blob`/`File`
  items inside arrays are now kept intact; only non-blob items are stringified.
- **`createETag`** — the default hash ran over `TextDecoder.decode(body)`,
  which maps every invalid UTF-8 byte to U+FFFD, so distinct binary bodies
  could collapse to the same string and share one *strong* ETag — yielding a
  spurious `304` that serves stale bytes. The default now hashes the raw bytes
  (`fnv1aHexBytes`); ASCII bodies are unaffected.
- **`createCompression`** — `Accept-Encoding` negotiation was a substring test,
  so it treated `gzip;q=0` (an explicit refusal) as acceptance and ignored a
  bare `*`. It now parses RFC 9110 `q`-weights and honors the `*` wildcard.
- **`coercePrimitive`** — a numeric path/query/header value of `Infinity` or
  `-Infinity` was coerced to a non-finite `number` that passed the type guard
  and then serialized back out as JSON `null`. Non-finite values now stay
  strings so the validator rejects them; finite forms (including exponential
  notation) still coerce.
