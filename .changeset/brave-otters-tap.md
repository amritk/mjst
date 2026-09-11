---
'@amritk/runtime-validators': minor
---

Add `maxErrors`, and cap error collection by default.

An error-collecting run recorded one object per failure with no ceiling, so a
200,000-element array of the wrong type produced 200,000 error objects — about
7.6 MB of JSON. `maxErrors` (default 1000) closes the one hole in a limit set
that already covered depth, work and unsafe patterns.

Unlike the other limits it does not throw: the run has reached a verdict, and the
cap only says how many errors are worth carrying back. Every error already
recorded is a real failure, so the walk stops once the list is full — the
200,000-element case now takes 2 ms instead of 43. Pass `Infinity` for the old
behaviour.
