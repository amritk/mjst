# @amritk/asyncapi

## 0.3.0

### Minor Changes

- c12bcf3: Key channel contracts on the wire tag a payload declares, not the AsyncAPI message name.

  **Breaking:** `stripDiscriminator(payload, discriminator, messageName)` is now
  `stripDiscriminator(payload, discriminator)` and returns `{ schema, tag? }` — the
  message name is no longer an input, because the payload's own `const` is the
  better answer. Contract keys change for any document whose message names differ
  from its wire tags.

  A payload usually states its tag itself (`type: { const: 'bot_added' }`), and
  that value is what arrives on the wire. Keying on the message name instead
  emitted contracts listening for frames that never come, and skipped every
  message whose name disagreed — the AsyncAPI _name_ is a document-authoring
  handle that 2.x messages inside a `oneOf` often do not have at all. The name is
  now only the fallback for a payload that pins nothing. On the vendored Slack RTM
  document, `mjst --input asyncapi --message-contracts` goes from 0 of 47 messages
  (2.6) and 3 of 47 (3.0) to 45 of 47 in both majors; the two dropped are genuine
  collisions, where Slack declares two messages for one wire tag.

  Also refused now, with a clear reason: a payload pinning its tag to a non-string,
  which no frame could ever be routed by.

- c12bcf3: Convert Avro message payloads instead of skipping them.

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
  `'unsupported'`. A `$ref` from a JSON Schema payload into an Avro _component_
  still degrades to an unconstrained schema with an issue.

### Patch Changes

- c12bcf3: Read an AsyncAPI 3.0 Multi Format Schema Object the way the spec does.

  `unwrapMultiFormat` required both `schemaFormat` and `schema` to be present, but
  `schemaFormat` is optional on the wrapper and defaults to the AsyncAPI dialect —
  the 3.0 meta-schema decides on `schema` alone. A payload written as
  `{ schema: { ... } }` was therefore read as a schema whose only keyword was one
  no dialect defines, and the message generated an empty type. A node with a
  `schemaFormat` but no `schema` is still a plain Schema Object, so nothing that
  worked before changes.

- Updated dependencies [15ad934]
  - @amritk/helpers@0.21.0
  - @amritk/adapters@0.6.2

## 0.2.0

### Minor Changes

- 5364409: AsyncAPI documents now generate `defineMessages` channel contracts, not just
  parsers.

  Phase one made `mjst --input asyncapi` produce a parser and validator per
  message _payload_. That is half of what the document says. The other half —
  which messages belong to which channel, which way each one flows, and which one
  a given frame is — is exactly what `@amritk/api`'s message contracts need and
  what a payload schema cannot express. `--message-contracts` writes it down:

  ```bash
  mjst --input asyncapi --schema api.yaml --out-dir src/generated --message-contracts
  ```

  ```ts
  import { rootMessages } from "./generated/contracts";
  import { bindMessages } from "@amritk/api";

  const channel = bindMessages(rootMessages, socket);
  for await (const message of channel.messages) {
    if (message.type === "say") console.log(message.text); // narrowed, from the document
  }
  ```

  One `contracts/<channel>.ts` per channel, each a `defineMessages({ … })` with
  the schemas inline as `as const` literals, plus a barrel. `receive` becomes
  `clientToServer` and `send` becomes `serverToClient` — the direction names
  already agreed, which is why phase one normalized 2.x's `publish`/`subscribe`
  into them.

  **The message name is the wire tag, and the tag leaves the payload.**
  `@amritk/api` reads the discriminator off a frame to select the message, then
  removes it before validating the payload — so `assertMessageSchema` refuses a
  schema that still declares it, and a schema that did would be unsatisfiable
  anyway. AsyncAPI documents, meanwhile, almost always declare it: a channel
  carrying a `oneOf` of messages has nothing _but_ the tag to tell them apart, so
  `type: { const: 'hello' }` is how the document says which message this is. The
  two conventions are the same fact written twice, and the generator reconciles
  them by trusting the message name and dropping the copy (with its `required`
  entry).

  Only a declaration that _agrees_ with the message name is dropped. A payload
  pinning the tag to some other value is skipped with a warning rather than
  silently rewritten — the wire tag and the contract key would disagree, and the
  emitted contract would listen for a frame that never arrives. This is not a
  hypothetical: Slack's RTM document names its messages `botChanged`,
  `emojiRemoved`, `channelArchive` while the wire carries `bot_added`,
  `emoji_changed`, `channel_archive`, so three of its forty-seven messages project
  cleanly and the rest are reported with the reason. A message no operation names
  has no direction and is skipped the same way; a message with no payload at all
  gets `{ type: 'object' }`, because dropping it would close a legitimate frame as
  `unknown-type`.

  **`--discriminator <prop>`** covers a document whose frames are not tagged
  `type`, and a channel can say so itself with `x-mjst: { discriminator: 'event' }`
  — now part of the `x-mjst` extension (`getMjstDiscriminator` in
  `@amritk/helpers`), read off the channel rather than off a schema. The channel's
  own declaration wins over the flag: one flag covers a whole run, and a run may
  span channels that disagree. Gemini's market-data feed is the case that needs
  this — its payload's `type` is the market schema's own `oneOf` selector
  (`heartbeat` / `update`), so the message tag has to be some other property.

  **The generated contracts import `@amritk/api`, which is the consumer's
  dependency, not the CLI's.** The files say so in their header, the CLI prints a
  tip when the package is not declared where the output lands (the same
  nearest-`package.json` walk `--helpers` auto-detection uses), and `--build`
  leaves the contract modules as `.ts` — handing `tsc` an import the output's
  project has not installed yet would fail the whole compilation, parsers
  included. `--message-contracts` requires `--input asyncapi` and refuses
  `--types-only`, since a contract is a runtime value.

  `@amritk/asyncapi` grows the shaping layer behind all of this, usable on its
  own and with no dependency on `@amritk/api`: `buildChannelContract(channel,
{ discriminator? })` → `{ exportName, discriminator, clientToServer,
serverToClient, issues }`, plus `resolveDiscriminator`, `stripDiscriminator`
  and `sanitizeToken`. `NormalizedChannel` gains the `discriminator` its
  `x-mjst` extension declared.

  One name does not survive the projection: a message called `__proto__` is
  skipped with an issue. Message names come from the document, and that one is
  the single key an object literal cannot carry — `{ "__proto__": … }` in the
  emitted contract would set the prototype instead of declaring a message, and no
  quoting escapes it. The direction maps are built through `Map` and
  `Object.fromEntries` so nothing else can go the same way silently.

### Patch Changes

- Updated dependencies [5364409]
  - @amritk/helpers@0.20.0

## 0.1.0

### Minor Changes

- 21145a6: The generate pipeline now consumes AsyncAPI documents: `mjst --input asyncapi
--schema api.yaml --out-dir src/generated` walks an AsyncAPI 2.0–2.6 or 3.0
  document (JSON or YAML) and generates parsers — plus `--validators`,
  `--examples`, `--build`, and the rest of the existing flags — for **every
  message payload and headers schema** it declares, each in its own
  `channels/<channel>/<message>[-headers]/` subtree, exactly the way
  `--schema-dir` gives each schema file its own directory.

  **What "consumes" means, concretely.** A new `@amritk/asyncapi` package (this
  release) does the document work, and it is usable on its own
  (`extractAsyncApi(document)` → normalized model, `listMessageSchemas(model)` →
  generator inputs; no I/O, parsing and cross-file `$ref` resolution stay the
  caller's job):

  - Both majors normalize into one 3.0-shaped model. 2.x `publish` becomes
    `receive` and `subscribe` becomes `send` — directions named from the
    application's point of view, the same convention as `@amritk/api`'s message
    contracts, and the reason AsyncAPI 3.0 renamed the pair itself.
  - Message and operation traits are shallow-merged _before_ `schemaFormat` is
    read, so a trait-contributed format gates its payload like an inline one.
  - Payloads are normalized to the JSON Schema 2020-12 the generators expect:
    the AsyncAPI default dialect (a draft-07 superset) and declared draft-07 go
    through the draft-07 upgrade, OpenAPI-format payloads get `nullable` folded
    into `type`, declared 2020-12 passes through. 3.0 Multi Format Schema
    Objects are unwrapped.
  - Every `$ref` into `#/components/schemas/...` is rebased into a local
    `$defs` with the referenced components copied in transitively, so each
    extracted schema is **self-contained** — and still yields one named type
    per component rather than an inlined blob.
  - A payload whose `schemaFormat` is not a JSON Schema dialect (Avro,
    Protobuf, RAML, …) is skipped with a warning naming the message and format;
    the document's other messages still generate. Only a document yielding
    nothing generatable fails the run.

  **`mjst lint` grows preset names.** `--ruleset asyncapi` (aliases
  `loupe:asyncapi`, `spectral:asyncapi`) and `--ruleset oas` (aliases
  `loupe:oas`, `spectral:oas`) now resolve to the built-in presets from
  `@amritk/lint/rules/*` — previously the presets shipped in the library but the
  CLI could only load ruleset _files_, so linting an AsyncAPI document from the
  CLI meant writing a JS ruleset by hand. Unknown names still resolve as file
  paths.

  **`@amritk/adapters`**: `SourceFormat` gains `'asyncapi'`. It is a
  document-on-disk format like `'json'`, not an adapter — `getAdapter('asyncapi')`
  still throws, and the CLI branches before reaching it.

  Flag interactions: `--input asyncapi` rejects `--schema-dir`, `--out-file`,
  `--root-type`, and `--export`, each with an error saying why. Root type names
  come from message identity (`lightMeasured` → `LightMeasured`), never the
  schema `title` — two messages titled "Event" stay distinct. Colliding output
  names dedupe deterministically (`-2`, `-3`, …) with a warning rather than
  failing, because documents in the wild collide.

  **`@amritk/helpers`**: `upgradeDraft07Schema` now merges the renamed
  `definitions` into an authored `$defs` block instead of replacing it — a
  draft-07 document carrying both no longer loses every authored entry (and the
  refs pointing at them) during the upgrade.

  This is phase one of AsyncAPI support: generating `defineMessages`-compatible
  channel contracts, and projecting AsyncAPI documents _from_ `@amritk/api`
  route contracts, are the planned follow-ups.

### Patch Changes

- Updated dependencies [21145a6]
- Updated dependencies [eb425fe]
- Updated dependencies [c8cb8b0]
  - @amritk/helpers@0.19.0
