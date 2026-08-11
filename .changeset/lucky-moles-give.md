---
'@amritk/api': patch
---

Fail the compile when an app export collides with a generated internal.

The emitted module imports the app's exports unaliased and declares roughly
twenty internals of its own — `notFound`, `internalError`, `toResponse`,
`observed`, `stripHeadBody`, and so on — each a plausible name for a route,
mount, or hook. A collision produced a module declaring the name twice, so it
failed to load with a `SyntaxError` naming an identifier the author never wrote,
in a file they did not author. `compileToModule` now says so at build time,
naming the export and the fix. The internal names are read back out of the
emitted source rather than listed, so the check cannot drift as the emitter
grows.
