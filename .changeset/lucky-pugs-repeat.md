---
'@amritk/api': minor
---

`@amritk/api/bundler` ships the contract strip as a transform instead of a plugin per bundler

**Breaking.** `stripContractsVite`, `stripContractsRollup`, `stripContractsEsbuild`, and `stripContractsBun` (and their option/plugin types) are gone. The subpath now exports `stripContractFields(source)` — the transform those four all wrapped — plus `isScannableId(id)`, the module-id filter to put in front of it. Migration is a few lines against your bundler's own per-module hook; the README carries a snippet for Vite/Rollup, esbuild/`Bun.build`, and an rspack/webpack loader.

```ts
// vite.config.ts — what stripContractsVite() was doing
import { isScannableId, stripContractFields } from '@amritk/api/bundler'

const stripContracts = {
  name: 'strip-contracts',
  enforce: 'pre',
  apply: 'build',
  transform(code: string, id: string, options?: { ssr?: boolean }) {
    if (options?.ssr === true || !isScannableId(id) || !code.includes('defineContract')) return null
    const stripped = stripContractFields(code)
    return stripped === code ? null : { code: stripped, map: null }
  },
}
```

The `exclude` option has no replacement because it no longer needs one: the filtering is a condition in a hook you own, alongside whatever else you want to scope by.

**Why.** A plugin per bundler is a matrix that is permanently one entry behind — a build on rspack found four plugins and no fifth, and Turbopack, Farm, and Rolldown queue up behind it. The transform is the whole asset (the parser, the conservative bail-outs, the line-preserving rewrite); the wrappers were ~10 lines each of hook shape that the bundler's own docs describe better. Nothing changes about what gets stripped or the ~75% of contract bytes it removes, and the size test now bundles through the documented `Bun.build` wiring, so the snippets are covered rather than merely written down.

Two clarifications, since the plugins were being reached for to solve something they cannot: the strip is a size optimization only, and it is not the way to keep `node:*` out of a browser bundle — bundlers resolve modules before eliminating them, so an unresolvable built-in fails the build before any tree-shaking runs. Contracts files should import `defineContract` from `@amritk/api/client`, whose import graph is guaranteed free of server modules and `node:*` by a test.
