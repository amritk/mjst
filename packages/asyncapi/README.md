<div align="center">

# @amritk/asyncapi

**Extract JSON Schemas — and `@amritk/api` channel contracts — from AsyncAPI 2.x/3.0 documents.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/asyncapi?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![AsyncAPI](https://img.shields.io/badge/AsyncAPI-2.x%20%7C%203.0-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/asyncapi` walks an AsyncAPI document — 2.0 through 2.6, or 3.0 — and pulls every message's payload and headers out as **self-contained JSON Schema 2020-12 documents**, ready for [`@amritk/generate-parsers`](../generate-parsers), [`@amritk/generate-validators`](../generate-validators), [`@amritk/generate-examples`](../generate-examples), or [`@amritk/runtime-validators`](../runtime-validators). It is the extraction layer behind `mjst --input asyncapi`.

What "self-contained" buys: the AsyncAPI default schema dialect (a draft-07 superset) is upgraded to 2020-12 conventions, OpenAPI-format payloads get `nullable` folded into their `type`, and every `$ref` into the document's `#/components/schemas/...` is rebased into a local `$defs` with the referenced components copied in transitively — so each extracted schema stands alone as a generator input.

It also projects each channel onto a [`@amritk/api`](../api) **messages contract**: the two directions AsyncAPI declares become `clientToServer`/`serverToClient`, each message's name becomes its wire discriminator value, and the discriminator property is stripped out of the payload — which is exactly the shape `defineMessages` takes. That projection is what `mjst --input asyncapi --message-contracts` writes to disk.

Both majors normalize into one 3.0-shaped model. Directions are named from the application's point of view (2.x `publish` → `receive`, `subscribe` → `send`), matching [`@amritk/api`](../api)'s message contracts. An Avro `schemaFormat` is **converted**, not skipped — [`@amritk/adapters`](../adapters) already reads Avro, so those payloads reach the generators like any other. A payload in a language nothing here reads (Protobuf, RAML) is skipped per message with a recorded issue, and so is an Avro schema the converter rejects — one bad payload never costs the document's other messages.

---

## Installation

```bash
npm install @amritk/asyncapi
# or
pnpm add @amritk/asyncapi
# or
yarn add @amritk/asyncapi
# or
bun add @amritk/asyncapi
```

---

## Usage

```ts
import { extractAsyncApi, listMessageSchemas } from '@amritk/asyncapi'

// Parse the document yourself (JSON.parse, @amritk/yaml, ...) — this package
// takes the already-parsed value and never touches the filesystem or network.
const model = extractAsyncApi(document)

for (const issue of model.issues) {
  console.warn(`${issue.path}: ${issue.message}`)
}

for (const channel of model.channels) {
  for (const message of channel.messages) {
    // message.payload / message.headers are self-contained JSON Schema 2020-12
    console.log(channel.key, message.name, message.direction)
  }
}

// Flatten into generator inputs: one { subDir, rootTypeName, schema } per
// payload/headers, laid out as channels/<channel>/<message>[-headers].
const schemas = listMessageSchemas(model)
```

### Channel contracts

```ts
import { buildChannelContract } from '@amritk/asyncapi'
import { defineMessages } from '@amritk/api'

for (const channel of model.channels) {
  const contract = buildChannelContract(channel)
  for (const issue of contract.issues) console.warn(`${issue.path}: ${issue.message}`)

  // The two maps are keyed by the value a frame carries on the wire, payloads
  // already stripped of the tag — hand them straight to defineMessages.
  const messages = defineMessages({
    discriminator: contract.discriminator,
    clientToServer: contract.clientToServer,
    serverToClient: contract.serverToClient,
  })
}
```

The discriminator is resolved in priority order: `x-mjst: { discriminator }` on the channel, then the `discriminator` option, then `'type'` (matching `@amritk/api`'s default). The document wins over the option deliberately — one option covers a whole run, and a run may span channels that disagree.

**The key is the tag, not the name.** A payload usually states its own tag — `type: { const: 'bot_added' }` is how a channel of alternatives says which message is which — and that value becomes the contract key, because it is what actually arrives on the wire. The AsyncAPI message *name* is only the fallback for a payload that pins nothing; it is a document-authoring handle, and 2.x messages inside a `oneOf` frequently have none at all. Slack's RTM document names a message `botAdded` and tags it `bot_added`; keying on the name would emit a contract listening for a frame that never comes.

Two messages that pin the *same* tag in the *same* direction are one frame shape with two descriptions, so the first wins and the second is reported (Slack declares two messages for its single `bot_added` event). A payload that constrains the tag without pinning it to one string — `type: { type: 'string' }`, a multi-member `enum`, a non-string `const` — names no message the runtime could select, and is skipped with an issue.

**Headers are not part of a contract.** `listMessageSchemas` emits a message's `headers` schema as its own generatable tree, but `buildChannelContract` projects payloads only: `@amritk/api` message contracts describe WebSocket frames, which carry no headers of their own. For a Kafka or MQTT document the headers types are still generated (under `<message>-headers/`) — they are simply yours to apply at the broker boundary, not something the socket runtime validates.

Cross-file and remote `$ref`s are the loader's job: resolve them first (for example with [`@amritk/resolve-refs`](../resolve-refs)); a still-unresolved external reference is reported as an issue, never fetched.

---

## API

- **`extractAsyncApi(document, options?)`** → `AsyncApiModel` — the normalized document: `version`, `major`, `title?`, `channels` (each with `key`, `address?`, `messages`), and collected `issues`. Throws only when the input is not an AsyncAPI document at all. `options.avroEncoding` picks which JSON shape an Avro payload describes: `'json'` (default) is the decoded object an application works with, `'avro-json'` is the spec's JSON encoding as it travels on the wire.
- **`listMessageSchemas(model, issues?)`** → `ExtractedSchema[]` — one `{ subDir, rootTypeName, schema }` per generatable payload/headers, with deterministic collision-suffixed directory tokens; collision issues are appended to `model.issues` (or to the `issues` array you pass).
- **`buildChannelContract(channel, options?)`** → `ChannelContract` — one channel as `{ exportName, discriminator, clientToServer, serverToClient, issues }`, ready for `defineMessages`.
- **`resolveDiscriminator(channel, override?)`** / **`DEFAULT_DISCRIMINATOR`** — the priority order above, and the `'type'` fallback.
- **`stripDiscriminator(payload, discriminator)`** → `{ schema, tag? }` or `{ issue }` — the payload with its tag removed plus the value it pinned the tag to, or why neither could be read.
- **`sanitizeToken(value, fallback)`** — the filesystem- and import-safe token both output layouts name a channel or message with.
- **`detectAsyncApiVersion(document)`** — the `asyncapi` version and its major, or `undefined`.
- **`classifySchemaFormat(schemaFormat)`** — which schema language a `schemaFormat` names (`'asyncapi' | 'draft-07' | '2020-12' | 'openapi' | 'avro'`), or `'unsupported'`.
- **`mergeTraits(target, traits, precedence)`** — trait application as an RFC 7386 JSON Merge Patch (recursive, so nested contributions from both sides survive); `precedence` is `'trait'` for 2.x (traits override the target) or `'target'` for 3.0 (the target wins). Applied before `schemaFormat` is read.

---

## License

MIT
