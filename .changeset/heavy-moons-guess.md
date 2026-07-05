---
'@amritk/generate-parsers': patch
---

Fix the published build shipping an unparseable regex. tsc-alias's
`--resolveFullPaths` pass rewrote the embedded-helper import-rewrite pattern
inside the compiled output, leaving v0.12.3 (and the mjst 0.7.15 CLI on top of
it) crashing with `SyntaxError: Invalid regular expression` on load. The
pattern now starts with a word boundary that keeps tsc-alias from matching it,
and a new dist smoke test (`bun run test:dist`) loads every compiled module
under plain Node and runs the CLI from `dist/` in CI and before every publish
so build-step corruption can no longer ship.
