---
"@amritk/mjst": minor
---

Resolve external and remote `$ref`s when generating parsers. The codegen path
previously did a bare `JSON.parse`, so a schema referencing another file
(`{ "$ref": "./address.json" }`) or a remote URL failed. Schema loading now
dereferences cross-file and remote references with `@amritk/resolve-refs`,
inlining them into a single schema before generation. Same-document
(`#/$defs/...`) refs are left untouched so named-type output is unchanged.

The same safety flags as `mjst lint` are exposed — `--resolve-remote`,
`--allowed-hosts`, and `--allow-private-hosts` — with remote fetching off by
default (a schema with a remote `$ref` fails rather than making a network call
unless opted in). Unresolvable references (a missing file, a refused host, a bad
URL) fail the run with the underlying reason. Works with `--schema-dir`, where
each schema resolves its own references.
