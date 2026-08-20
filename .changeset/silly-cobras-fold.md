---
'@amritk/helpers': minor
---

`quoteJsString` and `escapeRegexPattern` lost unpaired surrogates.

A lone surrogate is a legal JSON string (`"\ud800"`), so it is a legal property
name, `pattern`, or enum member — but it has no UTF-8 encoding. Both helpers
passed one through raw, and writing the generated file replaced it with U+FFFD:
the string literal on disk was a *different string* than the schema declared, so
the emitted check rejected a value the document says is valid, and an emitted
regex matched a different character than its author wrote. Both now escape an
unpaired surrogate (`\ud800`, matching the identical character). A well-formed
surrogate pair encodes fine and stays on the fast path, so emoji in a property
name cost nothing.
