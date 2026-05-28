---
"@amritk/generate-parsers": minor
"@amritk/generate-validators": minor
"@amritk/helpers": minor
"@amritk/mjst": minor
---

Make the generated type-name suffix configurable and default it to no suffix.

`refToName` previously always appended `Object` to every type name derived from
a `$ref` (e.g. `Contact` → `ContactObject`). It now accepts an optional `suffix`
that defaults to `''`, so generated types, parsers, and validators use the plain
PascalCase name by default.

A new `typeSuffix` option threads through the generators and the CLI
(`--type-suffix <suffix>`) to restore or customize the suffix — pass
`--type-suffix Object` to keep the previous `ContactObject` naming.

**Breaking:** with no `typeSuffix` set, generated type/parser/validator names no
longer include the `Object` suffix. Set `typeSuffix: 'Object'` (or
`--type-suffix Object`) to preserve the old output.
