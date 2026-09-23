---
"@amritk/mjst": minor
"@amritk/resolve-refs": minor
---

`mjst lint` no longer lints the salvage of a malformed `$ref`-referenced YAML file. A referenced file with a YAML parse error, or with more than one `---` document (of which only the first was read), is now reported as an `unresolved-ref` finding at the `$ref` that names it, with the file's path and the problem's `line:col` — so a run that used to pass on silently corrupted data now fails. Duplicate keys in a referenced YAML file are still accepted (last value wins), as in a referenced JSON file.

YAML parse errors from `mjst` AsyncAPI generation now name each problem's `path:line:col`, and a multi-document refusal points at the `---`/`...` marker the second document follows. The wording of both changed: `Failed to parse YAML: <path>:<line>:<col>: …` (the path is no longer repeated in the header) and `<path>:<line>:<col>: this file contains multiple YAML documents (another one follows this marker); …`. `unresolved-ref` messages and `Failed to resolve $refs` errors no longer start with a stray `Error: `.

The linted document (and an AsyncAPI or JSON Schema input) is no longer read and parsed a second time when it carries cross-file `$ref`s; on an 11 MB YAML spec this takes the resolve step from ~970 ms to ~550 ms.

A multi-document (`---`) root is now resolved one document at a time, each as a root of its own: `#/…` — and a `$ref` naming the root file, or one pointing back at it from a referenced file — means the document the reference is written in. Previously only the first document's `$ref`s were resolved (cross-file refs in later documents, including missing files, were silently skipped), and a stream with only internal refs resolved each `#/…` against the array of documents and reported it unresolved. The resolved view keeps the linted shape: an array of documents, addressed as `$[i]` in rules, whether or not a rule is `resolved`. Findings and `unresolved-ref`s land on the right document's lines; a failure inside a referenced file is anchored at the start of the document that pulled it in.

`@amritk/resolve-refs`: new `rootDocument` option on `resolveRefsFromFile` — the root's already-parsed value. When set, the root file is neither read nor parsed; its location still anchors relative refs, `allowedRoots`, and `origins`. The value is only read, never written to or aliased into the result.
