---
'@amritk/api': patch
---

Prefix the emitted module's internal dispatch names, and bound the contract
scan's regex check.

The compiled module imports the app's own exports unaliased, so an app
exporting `dispatchFetch` (or `handleFetch`) and wiring it as a mount or hook
produced a module declaring that name twice — a `SyntaxError` at load with
nothing pointing at the cause. Both are `mjst`-prefixed now.

The "does this regex guess span a call site" check scanned to the end of the
module whenever there was no later `defineContract`, on every slash the scanner
guesses at. It is bounded to the candidate now.
