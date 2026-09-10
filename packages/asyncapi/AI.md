# @amritk/asyncapi — notes for AI coding agents

Extract every message payload/headers schema from an AsyncAPI 2.x/3.0 document
as self-contained JSON Schema 2020-12 for the mjst generators, and project each
channel onto an `@amritk/api` `defineMessages` contract. Full reference is
[README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions.

## Minimal example

```ts
import { extractAsyncApi, listMessageSchemas } from '@amritk/asyncapi'

const model = extractAsyncApi(parsedDocument) // takes a VALUE, not a path
const schemas = listMessageSchemas(model)
// → [{ subDir: 'channels/lighting-measured/light-measured', rootTypeName: 'LightMeasured', schema }, ...]
```

## Channel contracts

```ts
import { buildChannelContract } from '@amritk/asyncapi'

const contract = buildChannelContract(model.channels[0], { discriminator: 'event' })
// → { exportName: 'lobbyMessages', discriminator: 'event',
//     clientToServer: { say: schema }, serverToClient: { said: schema }, issues: [] }
// Keys are the wire tags the payloads pin, not the AsyncAPI message names.
```

Hand the two direction maps straight to `defineMessages` — that is what
`mjst --input asyncapi --message-contracts` writes out.

## Gotchas — where agents fail

1. **It takes an already-parsed document.** No filesystem, no YAML, no network —
   parse with `@amritk/yaml` / `JSON.parse` and resolve cross-file refs with
   `@amritk/resolve-refs` *before* calling. External `$ref`s still present are
   reported as issues, not fetched.
2. **Problems are collected, not thrown.** Read `model.issues`; only "this is
   not an AsyncAPI document" throws. An Avro `schemaFormat` is *converted* via
   `@amritk/adapters` (pass `{ avroEncoding: 'avro-json' }` for the wire shape
   instead of the decoded one); a Protobuf one, or an Avro schema the converter
   rejects, skips that one schema with an issue.
3. **Directions are application-relative.** 2.x `publish` → `receive`,
   `subscribe` → `send` (the app is the server). Absent when no operation names
   the message.
4. **Extracted schemas are copies.** `#/components/schemas/X` refs are rebased
   to `#/$defs/X` with components copied in per message — mutating one
   message's schema never affects another.
5. **Root type names come from message identity**, not schema `title` — two
   messages titled "Event" stay distinct.
6. **A contract's map key is the wire tag, not the message name.** `receive` →
   `clientToServer`, `send` → `serverToClient`, and the discriminator property is
   *stripped* from each payload: `@amritk/api` reads the tag off the frame to
   pick the message, then removes it before validating, and refuses a schema
   that still declares it. The key comes from the value the payload pins the tag
   to (`type: { const: 'bot_added' }` → key `bot_added`), and falls back to the
   message name only when the payload pins nothing. Two messages pinning the
   same tag in one direction collide: first wins, second reported.
7. **The discriminator has a priority order**: `x-mjst: { discriminator }` on
   the channel, then the caller's argument, then `'type'`. The document wins
   over the argument on purpose — one override covers a whole run, and a run
   may span channels that disagree.
8. **Contracts carry payloads only, never headers.** `listMessageSchemas` gives
   a message's `headers` its own `<message>-headers/` tree, but
   `buildChannelContract` ignores headers: an `@amritk/api` contract describes
   WebSocket frames, which have none. For a Kafka/MQTT document the headers
   types are generated and yours to apply at the broker boundary.
