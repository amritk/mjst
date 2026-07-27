---
'@amritk/generate-validators': patch
'@amritk/runtime-validators': patch
'@amritk/generate-examples': patch
'@amritk/generate-markdown': patch
'@amritk/generate-parsers': patch
'@amritk/resolve-refs': patch
'@amritk/helpers': patch
'@amritk/adapters': patch
'@amritk/lint': patch
'@amritk/yaml': patch
'@amritk/mjst': patch
'@amritk/api': patch
---

Repair the workspace type check and complete the published manifests

`bun run types:check` had been failing for three packages and nothing in CI ran
it. `@amritk/lint`, `@amritk/runtime-validators`, and `@amritk/yaml` were the
only tsconfigs without the `**/*.test.ts` exclude the other nine carry, so their
test files pulled the shared OpenAPI fixture loader into the program, where its
`@amritk/resolve-refs` / `@amritk/yaml` imports do not resolve from the repo
root. CI now runs `types:check` alongside the lint and test steps.

Every package declares `engines: { node: '>=20' }`, matching the Node target the
CLI already emits for, so an install on an older runtime warns instead of
failing at run time. Every library also declares `sideEffects: false` so bundlers
can tree-shake them — relevant to `@amritk/runtime-validators`, `@amritk/lint`,
and `@amritk/yaml`, which are built to ship into browsers and Workers. The CLI
is excluded: its bin runs on import.

`@amritk/runtime-validators` no longer depends on `json-schema-typed`. It never
imported the package, and the dependency was installed by every consumer of the
one package whose design goal is staying self-contained.
