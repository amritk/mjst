---
---

Move `@amritk/mini` and `@amritk/mini-native` out of this monorepo and into their own repository at [amritk/mini](https://github.com/amritk/mini). Both packages continue to publish under the same names from there.

Nothing here imported either package, so the extraction leaves no gap: the only tie in the other direction was `@amritk/runtime-validators`, the optional peer behind `@amritk/mini/forms`' schema arm, which the new repo consumes from npm like any other dependency.

Removed along with them: the `check:reactivity` script and its CI step (it guarded mini's compilerless-JSX footgun and travels with the package, which also ships it as `@amritk/mini/vite`), the `bundle` suite in `scripts/bench-compare.ts`, the mini aliases in `vitest.config.ts`, and the now-unused `alien-signals` catalog entry and `happy-dom` devDependency.

No published package here changes.
