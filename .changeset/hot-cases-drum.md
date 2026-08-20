---
'@amritk/generate-validators': patch
---

Refuse a type name TypeScript will not take. The root type name is used verbatim
and the type suffix is appended to every name derived from a `$ref`, so
`buildValidatorSchema(schema, 'my-doc')` emitted `export type my-doc = …` — output
that does not parse, discovered in the consumer's build with nothing to say about
where it came from. Generation now stops with the name and the reason.
