---
'@amritk/generate-validators': minor
'@amritk/generate-parsers': minor
'@amritk/parsers': minor
---

Move both generator engines into `@amritk/parsers` as internal modules.

The parser/type engine now lives at `src/parsers/` and the validator/coercer/
repairer engine at `src/validators/`, reached through the `#parsers/*` and
`#validators/*` subpath imports. `@amritk/parsers` no longer depends on
`@amritk/generate-parsers` or `@amritk/generate-validators`; it owns the code
those packages used to hold.

Nothing changes for consumers of `@amritk/parsers`: `generate`, `ALL_MODES`,
`GeneratedFile`, `GenerateOptions`, `Mode` and `ImportExtension` are the same,
and the generated output is byte-identical.

`@amritk/generate-parsers` and `@amritk/generate-validators` keep their public
API — `buildSchema` and `buildValidatorSchema` behave exactly as before — but
are now thin forwarding shims over the moved engines, re-exported through the
new `@amritk/parsers/internal/parsers` and `@amritk/parsers/internal/validators`
entry points. Both packages are being retired; import `@amritk/parsers`
instead.
