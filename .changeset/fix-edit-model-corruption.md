---
"@amritk/lint": patch
---

fix: repair document-corruption bugs in the parsers and auto-fix engine. JSON `setValue`/`removeProperty` on a missing path no longer create the property; removing or inserting members of compact sequence-entry maps (`- a: 1\n    b: 2`) keeps the `- ` dash and correct indentation; batched array ops (reorder + dedupe) no longer act on stale indices; plain YAML scalars are re-quoted when a bare value would change type or break the line; duplicate-key edits target the last (winning) occurrence; block-sequence comments survive reorder/remove; JSON array edits preserve original element text, Unicode, and layout; CRLF files keep CRLF on inserted lines; explicit-empty keys (`foo:`) are now editable; and the configured `duplicateKeys` severity is honored.
