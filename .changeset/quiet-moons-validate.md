---
'@amritk/mjst': minor
---

Add `--validators-only`: emit the validator half and no parser.

Every run that was not `--types-only` carried a parser, whether or not anything
asked for one. `--validators` added `isX`/`validateX` *beside* a parser rather
than instead of one, so the library's own default — a type and the functions that
judge it, nothing that builds a value — had no spelling on the CLI. Generating
code that only ever judges input it did not produce meant taking a parser along
and ignoring it.

`--validators-only` is the mirror of `--types-only` at the other end of the
ladder: one run with nothing that rewrites a document, the other with nothing
that executes at all. It implies `--validators`, so it does not need it as well,
and `--check`, `--coerce` and `--repair` shape its output exactly as they shape
`--validators`. It is rejected alongside `--types-only` and `--out-file`, for the
same reasons `--validators` already was.

`--validators` itself is unchanged and still emits a parser, so nothing existing
moves.
