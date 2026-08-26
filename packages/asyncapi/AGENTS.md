# AGENTS.md — @amritk/asyncapi

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Extracts message payload/headers schemas from AsyncAPI 2.x/3.0 documents as
self-contained JSON Schema 2020-12 for the mjst generators.

## Commands

```bash
bun run --filter='@amritk/asyncapi' test
bun run --filter='@amritk/asyncapi' types:check
```

## Invariants — do not break these

- **No I/O.** The package takes an already-parsed document value. Parsing
  (YAML/JSON) and cross-file `$ref` resolution belong to the caller (the CLI
  uses `@amritk/yaml` and `@amritk/resolve-refs`). Do not add either as a
  dependency here — `@amritk/helpers` stays the only one.
- **Issues are collected, never thrown**, except for "not an AsyncAPI document
  at all". One broken message must not cost the rest of the document.
- **Trait merge before `schemaFormat`.** A trait-contributed `schemaFormat`
  gates its payload like an inline one; reading it pre-merge misjudges Avro
  payloads as JSON Schema (a bug the lint preset had).
- **Extracted schemas are self-contained.** Every `#/components/schemas/...`
  ref is rebased into the message's own `$defs` (components copied
  transitively, normalized). Nothing downstream may need the source document.
- **Both majors, one model.** 2.x and 3.0 normalize into the 3.0-shaped
  `AsyncApiModel`; version-specific walking stays in `extract-channels-v2.ts` /
  `extract-channels-v3.ts`.
- The real-document corpus lives in `fixtures/asyncapi/` (shared with the lint
  preset) — extend it rather than inventing inline documents for new cases.
