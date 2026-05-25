---
"@amritk/adapters": minor
"@amritk/helpers": minor
"@amritk/generate-parsers": minor
"@amritk/generate-validators": minor
"@amritk/mjst": minor
---

Add schema adapters so the CLI can ingest schemas from external libraries. The
new `@amritk/adapters` package converts a source schema into Draft 2020-12 JSON
Schema before generation, leaving the core pipeline untouched. The CLI gains
`--input <format>` — `typebox`, `zod`, `valibot`, and `effect`, alongside the
default `json` — and `--export <name>` to pick which export of a schema module
to use.

Each source library is an optional peer dependency loaded at runtime. The Zod
(Zod 4 `toJSONSchema`) and Valibot (`@valibot/to-json-schema`) adapters map
their date types to the same `x-mjst` instanceOf extension used by TypeBox
dates; the Effect adapter (`JSONSchema.make`) passes through Effect's encoded
representation. Constructs JSON Schema cannot express are preserved via the
`x-mjst` extension, which the type generator, parsers, and validators
understand.

Constructs that JSON Schema cannot express (e.g. TypeBox's `Type.Date()`) are
preserved via an `x-mjst` vendor extension. The type generator, parsers, and
validators now understand `x-mjst: { instanceOf }`, emitting the class type, an
`instanceof` check (with `Date` coercion in non-strict parsers), and a matching
validator error.
