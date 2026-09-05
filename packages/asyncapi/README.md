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

Both majors normalize into one 3.0-shaped model. Directions are named from the application's point of view (2.x `publish` → `receive`, `subscribe` → `send`), matching [`@amritk/api`](../api)'s message contracts. Non-JSON-Schema payloads (`schemaFormat`: Avro, Protobuf, …) are skipped per message with a recorded issue — one Avro payload never costs the document's other messages.

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

  // The two maps are keyed by wire discriminator value, payloads already
  // stripped of the tag — hand them straight to defineMessages.
  const messages = defineMessages({
    discriminator: contract.discriminator,
    clientToServer: contract.clientToServer,
    serverToClient: contract.serverToClient,
  })
}
```

The discriminator is resolved in priority order: `x-mjst: { discriminator }` on the channel, then the `discriminator` option, then `'type'` (matching `@amritk/api`'s default). The document wins over the option deliberately — one option covers a whole run, and a run may span channels that disagree.

A message whose payload pins the tag to something *other* than its own name is skipped with an issue rather than rewritten: the wire tag and the contract key would disagree, so the emitted contract would listen for a frame that never arrives. Slack's RTM document renames nearly every one of its tags this way, and only three of its messages project cleanly.

Cross-file and remote `$ref`s are the loader's job: resolve them first (for example with [`@amritk/resolve-refs`](../resolve-refs)); a still-unresolved external reference is reported as an issue, never fetched.

---

## API

- **`extractAsyncApi(document)`** → `AsyncApiModel` — the normalized document: `version`, `major`, `title?`, `channels` (each with `key`, `address?`, `messages`), and collected `issues`. Throws only when the input is not an AsyncAPI document at all.
- **`listMessageSchemas(model, issues?)`** → `ExtractedSchema[]` — one `{ subDir, rootTypeName, schema }` per generatable payload/headers, with deterministic collision-suffixed directory tokens; collision issues are appended to `model.issues` (or to the `issues` array you pass).
- **`buildChannelContract(channel, options?)`** → `ChannelContract` — one channel as `{ exportName, discriminator, clientToServer, serverToClient, issues }`, ready for `defineMessages`.
- **`resolveDiscriminator(channel, override?)`** / **`DEFAULT_DISCRIMINATOR`** — the priority order above, and the `'type'` fallback.
- **`stripDiscriminator(payload, discriminator, messageName)`** → `{ schema }` or `{ issue }` — the payload with its tag removed, or why it could not be.
- **`sanitizeToken(value, fallback)`** — the filesystem- and import-safe token both output layouts name a channel or message with.
- **`detectAsyncApiVersion(document)`** — the `asyncapi` version and its major, or `undefined`.
- **`classifySchemaFormat(schemaFormat)`** — which JSON Schema dialect a `schemaFormat` names (`'asyncapi' | 'draft-07' | '2020-12' | 'openapi'`), or `'unsupported'`.
- **`mergeTraits(target, traits, precedence)`** — trait application as an RFC 7386 JSON Merge Patch (recursive, so nested contributions from both sides survive); `precedence` is `'trait'` for 2.x (traits override the target) or `'target'` for 3.0 (the target wins). Applied before `schemaFormat` is read.

---

## License

MIT
