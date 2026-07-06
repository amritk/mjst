---
'@amritk/mjst': minor
'@amritk/generate-parsers': minor
---

Default generated relative imports to the literal `.ts` extension so the output
runs under Node without a build step.

Generated `.ts` files imported siblings as `./x.js` — the TS NodeNext form Bun
and tsc resolve to the `.ts` file, but Node's type stripping (Node ≥ 22.18)
throws `ERR_MODULE_NOT_FOUND` because it does not remap `.js` → `.ts`. The CLI
now defaults `--import-ext` (config key `importExt`) to `ts`, emitting the
literal on-disk paths, so `node generated/index.ts` loads and parses directly.

`js` remains available for consumers who compile the output, and `--build`
still selects `js` automatically (tsc cannot emit from `.ts` specifiers). tsc
consumers running the `.ts` sources directly must set
`allowImportingTsExtensions` — documented in the CLI README. `--import-ext ts`
combined with `--build` stays an error.
