---
'@amritk/asyncapi': minor
---

Convert Avro message payloads instead of skipping them.

An `application/vnd.apache.avro` `schemaFormat` (bare, `+json` or `+yaml`) is now
handed to `@amritk/adapters` and reaches the generators as ordinary JSON Schema
2020-12, so `mjst --input asyncapi` produces types and parsers for an Avro-typed
channel. The converter was already in the monorepo; only the wiring was missing.

`extractAsyncApi(document, { avroEncoding })` picks which JSON shape the result
describes: `'json'` (the default) is the decoded object an application works
with, `'avro-json'` is the spec's wire encoding with its branch-tagged union
wrappers. A schema the converter rejects becomes an issue, like every other
per-message problem here — it is never thrown.

`classifySchemaFormat` gains an `'avro'` family, so it no longer reports Avro as
`'unsupported'`. A `$ref` from a JSON Schema payload into an Avro *component*
still degrades to an unconstrained schema with an issue.
