---
'@amritk/resolve-refs': patch
---

Read documents that start with a UTF-8 byte-order mark.

A BOM is an encoding marker, but once the bytes are decoded it is a stray
`U+FEFF` in front of the `{`, and `JSON.parse` refuses it — so a schema written
on Windows failed the whole resolve with an `Unrecognized token` naming an
invisible character. It is now dropped before parsing, for the default parser
and any custom `parse` alike.
