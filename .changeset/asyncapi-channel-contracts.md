---
'@amritk/asyncapi': minor
'@amritk/helpers': minor
'@amritk/mjst': minor
---

AsyncAPI documents now generate `defineMessages` channel contracts, not just
parsers.

Phase one made `mjst --input asyncapi` produce a parser and validator per
message *payload*. That is half of what the document says. The other half —
which messages belong to which channel, which way each one flows, and which one
a given frame is — is exactly what `@amritk/api`'s message contracts need and
what a payload schema cannot express. `--message-contracts` writes it down:

```bash
mjst --input asyncapi --schema api.yaml --out-dir src/generated --message-contracts
```

```ts
import { rootMessages } from './generated/contracts'
import { bindMessages } from '@amritk/api'

const channel = bindMessages(rootMessages, socket)
for await (const message of channel.messages) {
  if (message.type === 'say') console.log(message.text) // narrowed, from the document
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
carrying a `oneOf` of messages has nothing *but* the tag to tell them apart, so
`type: { const: 'hello' }` is how the document says which message this is. The
two conventions are the same fact written twice, and the generator reconciles
them by trusting the message name and dropping the copy (with its `required`
entry).

Only a declaration that *agrees* with the message name is dropped. A payload
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
