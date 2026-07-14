---
"@amritk/lint": patch
---

Parse multi-document (`---`-separated) YAML streams instead of silently
dropping everything after the first document.

`parseYaml` called `parseDocument`, which reads only the first document of a
stream, so any data, positions, or diagnostics in later documents were invisible
to the linter. It now uses `parseAllDocuments` and lints each document
independently: a multi-document source projects to an array of per-document
values, and every position key and finding path is prefixed with the zero-based
document index, so a violation in a later document resolves to its own
line:column range. Single-document sources are unchanged — `data` is still the
document value and paths stay unprefixed — so existing callers and rulesets are
unaffected.
