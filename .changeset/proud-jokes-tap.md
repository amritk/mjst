---
'@amritk/lint': patch
---

Keep the prototype guards local rather than importing `@amritk/helpers`, and
guard the severity lookup too.

The previous round replaced three hand-written guards here with imports from
`@amritk/helpers` — a package `@amritk/lint` does not depend on. Nothing in the
workspace catches that (vitest aliases the specifier to source and the install
is hoisted), but the build does not bundle, so the published `dist` would have
kept the bare specifier and `import '@amritk/lint'` would have thrown
`ERR_MODULE_NOT_FOUND` on the first import. The right fix is the local copies:
this package deliberately depends on nothing beyond
`@amritk/runtime-validators` and `@amritk/yaml`, which its own architecture
notes call out.

`SEVERITY_NAMES` was still a bare index in the same file. `severity:
'constructor'` resolved to `Object.prototype.constructor` — neither `'off'` nor
`undefined`, so both fallbacks were skipped and the rule was built carrying a
Function where a `DiagnosticSeverity` number belongs. Every comparison against
`DiagnosticSeverity.Error` is then false, so the CLI exits 0 on findings it
should fail for, and JSON output serializes the severity as `null`.
