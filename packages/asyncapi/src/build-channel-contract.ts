import { resolveDiscriminator } from './resolve-discriminator'
import { sanitizeToken } from './sanitize-token'
import { stripDiscriminator } from './strip-discriminator'
import type { ExtractionIssue, NormalizedChannel } from './types'

/** One direction's message map: wire name → payload schema, ready for `defineMessages`. */
export type ContractDirection = { readonly [name: string]: Record<string, unknown> }

/**
 * One channel projected onto an `@amritk/api` messages contract.
 *
 * The map keys *are* the wire discriminator values — that is what
 * `defineMessages` means by a message name — so a message that cannot be given
 * a legal key or a legal payload is left out and its reason recorded in
 * {@link ChannelContract.issues} rather than emitted broken.
 */
export type ChannelContract = {
  /** The `export const <name> = defineMessages(...)` identifier for this channel. */
  readonly exportName: string
  readonly discriminator: string
  /** What the client may send — AsyncAPI's `receive`, from the application's side. */
  readonly clientToServer: ContractDirection
  /** What the server may send — AsyncAPI's `send`. */
  readonly serverToClient: ContractDirection
  readonly issues: readonly ExtractionIssue[]
}

export type BuildChannelContractOptions = {
  /** Fallback discriminator when the channel does not name one (the CLI's `--discriminator`). */
  readonly discriminator?: string
}

/**
 * Turns a token like `market-data-v1` into the `marketDataV1Messages`
 * identifier the generated module exports. A token starting with a digit gets a
 * leading `_`, since `1inchTradesMessages` is not an identifier — and a real
 * channel is named `1inchusd` in the wild.
 */
const toExportName = (token: string): string => {
  const camel = token.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next === undefined ? '' : next.toUpperCase(),
  )
  return `${/^[A-Za-z_$]/.test(camel) ? camel : `_${camel}`}Messages`
}

/**
 * Projects one normalized channel onto a `defineMessages`-shaped contract.
 *
 * The two models nearly line up already — AsyncAPI 3.0 and `@amritk/api` name
 * directions from the same end — so the work is in the two places they do not:
 *
 * - **Direction.** `receive` (the application receives it) is what a client
 *   sends, hence `clientToServer`; `send` is `serverToClient`. A message no
 *   operation names has no direction at all, and a contract cannot guess one:
 *   putting it in the wrong half would validate frames flowing the wrong way
 *   and reject the ones that arrive.
 * - **The tag.** The message *name* becomes the wire key, and the payload has
 *   the tag stripped out of it (see {@link stripDiscriminator}), because the
 *   runtime removes it from the frame before validating.
 *
 * Everything skipped comes back as an issue naming the message and the reason,
 * so the caller can warn per message instead of failing the channel. A channel
 * that ends up with no messages at all is still returned: an empty contract is
 * a truthful one, and the issues say why it is empty.
 */
export const buildChannelContract = (
  channel: NormalizedChannel,
  options: BuildChannelContractOptions = {},
): ChannelContract => {
  const discriminator = resolveDiscriminator(channel, options.discriminator)
  const issues: ExtractionIssue[] = []
  // Maps, not object literals: message names come from the document, and
  // `target[name] = schema` on a plain object treats `__proto__` as the
  // prototype setter — the message vanished and nothing was recorded.
  const clientToServer = new Map<string, Record<string, unknown>>()
  const serverToClient = new Map<string, Record<string, unknown>>()

  for (const message of channel.messages) {
    const path = `#/channels/${channel.key}/messages/${message.name}`
    const skip = (reason: string): void => void issues.push({ path, message: reason })

    if (message.direction === undefined) {
      skip('message has no direction (no operation names it), so it belongs to neither half of the contract')
      continue
    }

    // A payload the extractor dropped (an Avro `schemaFormat`, a dangling
    // `$ref`) leaves `schemaFormat` behind as the trace of what was declared.
    // Emitting `{ type: 'object' }` for it would claim "any object is fine"
    // about a message whose shape we simply failed to read.
    if (message.payload === undefined && message.schemaFormat !== undefined) {
      skip(`payload was not extracted as JSON Schema (schemaFormat "${message.schemaFormat}")`)
      continue
    }

    // The one name that survives this map but not the file written from it: in
    // generated source `{ "__proto__": … }` sets the prototype rather than
    // declaring a message, and no quoting escapes that — only a computed key
    // would, which is not what the emitted literal is. A contract that has to
    // round-trip through source cannot carry a name source cannot express.
    if (message.name === '__proto__') {
      skip('a message named "__proto__" cannot be written as an object key in the generated contract')
      continue
    }

    const target = message.direction === 'receive' ? clientToServer : serverToClient
    if (target.has(message.name)) {
      skip(`two ${message.direction === 'receive' ? 'clientToServer' : 'serverToClient'} messages share the name`)
      continue
    }

    // No payload at all is not a problem to report: plenty of signals are the
    // tag and nothing else (`{"type":"goodbye"}`). Dropping such a message
    // would be the real damage — the contract is a closed set, so an omitted
    // message means a legitimate frame gets closed as `unknown-type`.
    if (message.payload === undefined) {
      // A fresh object per message: these end up in a shared contract that
      // callers are free to read, and one accidentally mutated literal must not
      // reshape every payload-less message in the document.
      target.set(message.name, { type: 'object' })
      continue
    }

    const stripped = stripDiscriminator(message.payload, discriminator, message.name)
    if (stripped.issue !== undefined) {
      skip(stripped.issue)
      continue
    }
    target.set(message.name, stripped.schema)
  }

  return {
    exportName: toExportName(sanitizeToken(channel.key, 'channel')),
    discriminator,
    // `Object.fromEntries` defines own properties rather than assigning them,
    // so even a hostile name lands as data on the object it belongs to.
    clientToServer: Object.fromEntries(clientToServer),
    serverToClient: Object.fromEntries(serverToClient),
    issues,
  }
}
