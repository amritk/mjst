---
"@amritk/mini": minor
---

`list` (and `For`, which wraps it) now reconciles with a move-minimal two-ended
keyed diff instead of the append-order walk.

- **Reordering is now O(moves), not O(n).** The previous reconciler was tuned
  for append and replace-the-tail and fell back to an `insertBefore` sweep that
  moved every node after the first mismatch — so a two-row swap or an early-row
  removal touched the whole tail. The new pass closes in from both ends, so
  swapping two rows is two DOM moves, removing an interior row is zero, and a
  reversal is one move per row. Append and replace-the-tail stay a no-move fast
  path, and node identity (focus, scroll, input state) is preserved throughout.
- **Core `.` size budget raised 2800 → 3000 B gzipped** to fit the diff (the
  bundled core is ~2.9 KB). Subpaths still add zero bytes to `.`, and the widget
  that imports only `.` pays for the diff once.
- No API change: same `list(container, items, key, create)` signature, same
  duplicate-key warning, same scope disposal on removal.
