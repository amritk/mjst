---
'@amritk/resolve-refs': patch
---

Report each resolve error at the `$ref` that caused it.

`ResolveError.path` promised "the location of the offending `$ref`" and never
delivered one: it was empty for a missing file, a refused host, or an external
ref, and for an unresolvable internal ref it held the path to the *target* — a
node the document by definition does not contain. A caller anchoring a
diagnostic on it (the CLI does) sent the reader to the top of the file, or to
whichever node sat nearest the hole.

It is now the path to the reference as written in the document you named, ending
in the keyword, so `['properties', 'pet', '$ref']` points at the `$ref` line
itself. It stays empty where there is genuinely nowhere to point: a budget the
whole resolve overran, or a reference living in another document.
