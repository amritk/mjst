---
---

Add a `prepublishOnly` guard to every publishable package.

`release:publish` prepares four things no checked-in manifest carries: concrete
versions in place of `workspace:`/`catalog:`, the `development` condition
stripped, a LICENSE copied into each package, and the `dist/` every entry point
names. All four happen in the ephemeral publish job, so all four are skipped by
an `npm publish` run anywhere else — and nothing caught that.

`scripts/check-publishable.mjs` runs from the package root as `prepublishOnly`
and fails the publish when a manifest points at a `dist/` file that is not on
disk, when a `development` condition is still present, or when the package
directory has no LICENSE. It reads `exports`, `bin`, `main`, `module` and
`types`, because `@amritk/mjst` is a CLI whose only entry is `bin` and whose
exports map carries nothing but `./package.json`, and it treats a wildcard
target as satisfied by any one file of that extension, which is the shape
`@amritk/helpers` publishes.

`@amritk/mjst@0.7.15` and `@amritk/generate-parsers@0.12.3` are the reason this
is worth a gate rather than a convention: both shipped dead on arrival and both
are deprecated on npm rather than fixable, because a published version is
forever. dist-smoke and cli-e2e guard the same ground for the repo; this guards
the act of publishing, which no CI step can reach.
