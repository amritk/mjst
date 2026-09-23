---
"@amritk/mjst": minor
"@amritk/resolve-refs": minor
---

`mjst lint` no longer lints the salvage of a malformed `$ref`-referenced YAML file. A referenced file with a YAML parse error, or with more than one `---` document (of which only the first was read), is now reported as an `unresolved-ref` finding at the `$ref` that names it, with the file's path and the problem's `line:col` — so a run that used to pass on silently corrupted data now fails. Duplicate keys in a referenced YAML file are still accepted (last value wins), as in a referenced JSON file.

YAML parse errors from `mjst` AsyncAPI generation now name each problem's `path:line:col`, and a multi-document refusal points at where the second document starts.

The linted document (and an AsyncAPI or JSON Schema input) is no longer read and parsed a second time when it carries cross-file `$ref`s; on an 11 MB YAML spec this takes the resolve step from ~970 ms to ~550 ms. The resolved view of a multi-document root now keeps the linted shape (an array of documents), so refs in later documents resolve too.

`@amritk/resolve-refs`: new `rootDocument` option on `resolveRefsFromFile` — the root's already-parsed value. When set, the root file is neither read nor parsed; its location still anchors relative refs, `allowedRoots`, and `origins`. The value is only read, never written to or aliased into the result.
