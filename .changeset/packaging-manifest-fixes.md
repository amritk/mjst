---
'@amritk/mjst': minor
'@amritk/helpers': minor
'@amritk/adapters': minor
'@amritk/generate-parsers': minor
'@amritk/api': patch
'@amritk/generate-examples': patch
'@amritk/generate-markdown': patch
'@amritk/generate-validators': patch
'@amritk/lint': patch
'@amritk/resolve-refs': patch
'@amritk/runtime-validators': patch
'@amritk/yaml': patch
---

Fix the published manifests so the packages install, resolve, and dedupe correctly

**Types resolve on TypeScript's default config.** Every package was
exports-only: nine declared `"module": "./dist/index.js"` (a field neither Node
nor TypeScript reads) and nothing declared `types`. A consumer on
`moduleResolution: "node10"` — still the default when `module` is `commonjs` —
cannot see `exports` at all, so `import { lintDocument } from '@amritk/lint'`
failed with `TS2307: Cannot find module '@amritk/lint' or its corresponding type
declarations`. Each package with a `.` export now also declares `main` and
`types`; `@amritk/helpers` and `@amritk/adapters` have no `.` export (they are
subpath-only), so they declare a `typesVersions` wildcard mapping instead, which
gives their subpaths the same node10 fallback. All of it is ignored under
`node16`/`nodenext`/`bundler`, where `exports` still wins.

**`workspace:*` resolves to a caret, not an exact pin.** All fourteen
inter-package edges shipped as exact versions, so installing two `@amritk/*`
packages published at different times pulled in two copies of their shared
dependency. That is not merely wasteful: the module-level caches those packages
rely on are per-copy, so the `WeakMap` validator cache in
`@amritk/runtime-validators` silently stopped hitting. Pre-1.0 a caret stays
narrow (`^0.9.1` is `>=0.9.1 <0.10.0`) and breaking changes here already ride a
minor bump.

**`@amritk/helpers` stops shipping 21 source files it does not need.** Embedded
mode reads four helper sources (`is-object`, `validate-array`,
`validate-record`, `has-ref`) out of the installed package at generation time,
so `src` has to ship — but only those four. `files` now lists them explicitly
instead of globbing all of `src`, cutting the tarball from 78 files / 206 kB to
63 / 112 kB.

**Two packages no longer declare a dependency they never import.**
`@amritk/mjst` and `@amritk/generate-parsers` both listed
`@amritk/generate-markdown` under `dependencies`, but the only importer is each
package's `scripts/generate-readme.ts`, which is not published. Both moved to
`devDependencies`. `@amritk/adapters` likewise dropped its
`@sinclair/typebox` peer dependency: the TypeBox adapter is purely structural
(it strips symbol keys) and imports nothing. `valibot` stays — it is a genuine
transitive peer of `@valibot/to-json-schema`.

**`@amritk/mjst` fixes.** `json-schema-typed` moved to `dependencies`, because
the shipped `dist/emit-examples.d.ts` imports types from it. The package gained
an `exports` map, so it is no longer deep-importable in its entirety. And the
build now marks `dist/cli.js` executable: `npm pack` records on-disk modes, and
package managers only `chmod` bin targets when they link them, so flows that
consume the tarball directly (vendoring, Docker `npm pack` + `tar -x`) hit
`EACCES`.
