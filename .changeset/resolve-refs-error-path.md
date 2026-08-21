---
'@amritk/resolve-refs': patch
---

A "Cannot resolve" error for a ref in a sub-document no longer reports a
position from the root document.

`refPathAt` indexes the root document only, so it can answer for a ref that
lives there and nothing else. Called unguarded, it matched a ref in a
sub-document against the root's index and handed back the position of an
identical ref there — pointing a diagnostic at a line that is not the offending
one. The prefetch loop already guarded this the same way; the error path now
does too, reporting an empty path when there is no position to give.
