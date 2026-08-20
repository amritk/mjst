---
'@amritk/yaml': patch
---

Three more fixes from the same review pass.

- **`parseDocument` no longer swallows a document that starts with three dots.**
  The `...` end-marker test matched the dots on their own rather than requiring
  the marker to stand alone, so `...abc`, `....` and `...abc: 1` came back as an
  empty document with no diagnostic — while `parseAllDocuments` on the same
  source parsed them correctly, as do `yaml` and `js-yaml`. Both entry points now
  use the same marker detector.
- **`nodeAtPath(root, path, true)` falls back to the closest node when the path
  runs past a dangling alias.** Every other dead end yields the deepest node that
  exists; this one yielded `undefined`, dropping the very span a caller reporting
  an unresolved alias wants to point at.
- **An anchor or alias name ending in `:` now warns** (`AMBIGUOUS_ANCHOR_NAME`).
  YAML makes the `:` part of the name, so `*x: v` aliases `x:` and the mapping
  keeps no separator — the parser reads it that way, per spec, but the
  `UNRESOLVED_ALIAS` it earned on its own named an anchor the document never
  wrote. `yaml` warns here too; `js-yaml` rejects the document.
