---
'@amritk/api': patch
---

Check the generated module's import lines for collisions too. The
already-declared check read `const`/`let`/`function`/`class` declarations, but
the module also imports unaliased from the runtime and the validators — so an
app exporting `readBodyCapped`, `buildResponseHeaders` or `hashContracts`
collided there rather than with a declaration, and the check passed on a module
that would not load.
