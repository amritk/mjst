# AGENTS.md — @amritk/asyncapi

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Extracts message payload/headers schemas from AsyncAPI 2.x/3.0 documents as
self-contained JSON Schema 2020-12 for the mjst generators, and projects each
channel onto an `@amritk/api` `defineMessages` contract.

## Commands

```bash
bun run --filter='@amritk/asyncapi' test
bun run --filter='@amritk/asyncapi' types:check
```

## Invariants — do not break these

- **No I/O.** The package takes an already-parsed document value. Parsing
  (YAML/JSON) and cross-file `$ref` resolution belong to the caller (the CLI
  uses `@amritk/yaml` and `@amritk/resolve-refs`). Do not add either as a
  dependency here. The only two are `@amritk/helpers` and `@amritk/adapters`,
  the latter reached through its `avro-to-json-schema` subpath alone so none of
  the optional peers (zod, valibot, effect) can be dragged in.
- **Issues are collected, never thrown**, except for "not an AsyncAPI document
  at all". One broken message must not cost the rest of the document.
- **Trait merge before `schemaFormat`.** A trait-contributed `schemaFormat`
  routes its payload like an inline one; reading it pre-merge misjudges Avro
  payloads as JSON Schema (a bug the lint preset had).
- **Avro is converted, not refused.** `classifySchemaFormat` gives it its own
  family and `normalize-message` hands it to `@amritk/adapters`. A conversion
  that throws becomes an issue, like everything else here. The one place Avro
  still degrades is a *component* an otherwise-JSON-Schema payload `$ref`s into
  — see `isCopyableFamily` in `rebase-component-refs.ts` for why.
- **Extracted schemas are self-contained.** Every `#/components/schemas/...`
  ref is rebased into the message's own `$defs` (components copied
  transitively, normalized). Nothing downstream may need the source document.
- **Both majors, one model.** 2.x and 3.0 normalize into the 3.0-shaped
  `AsyncApiModel`; version-specific walking stays in `extract-channels-v2.ts` /
  `extract-channels-v3.ts`.
- The real-document corpus lives in `fixtures/asyncapi/` (shared with the lint
  preset) — extend it rather than inventing inline documents for new cases.
- **The contract layer never imports `@amritk/api`.** `defineMessages` is the
  *generated code's* peer, not this package's; `resolve-discriminator.ts` keeps
  its own `DEFAULT_DISCRIMINATOR = 'type'` literal in step with the runtime's,
  and the CLI's keystone test is what holds the two together.
- **A message's map key is its wire tag, not its name.** `stripDiscriminator`
  removes the tag from the payload — the runtime removes it from the frame
  before validating, and `assertMessageSchema` refuses a payload that still
  declares it — and returns the value the payload pinned it to.
  `buildChannelContract` keys each direction by that value, falling back to the
  message name only when the payload pins nothing. Keying by name instead
  emitted contracts listening for frames that never arrive: Slack's RTM
  document tags `botAdded` as `bot_added`, and projecting it by name kept 3 of
  its 47 messages where the tag keeps 45.
- **Contracts carry payloads only.** A message's `headers` schema gets its own
  generatable tree from `listMessageSchemas`, but never reaches a contract:
  `@amritk/api` contracts describe WebSocket frames, which have no headers. Do
  not add a headers slot without a transport that can fill it.
