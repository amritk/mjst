---
'@amritk/mjst': minor
---

Select `package` helpers mode only when `@amritk/helpers` is a declared
dependency of the target project.

Auto-detection previously chose `package` mode whenever `@amritk/helpers` was
merely *resolvable*, which includes being hoisted into `node_modules` as a
transitive dependency of `@amritk/mjst`. The generated code then worked under
npm/bun's hoisted layouts but broke under pnpm/isolated installs, where an
undeclared package is unreachable at runtime. Detection now reads the nearest
`package.json` above the output directory and picks `package` only when
`@amritk/helpers` is listed in its dependencies (or dev/peer/optional);
otherwise it falls back to the self-contained `embedded` mode and prints a tip
to declare `@amritk/helpers` for a shared helper copy. The explicit
`--helpers package|embedded` override still skips detection.
