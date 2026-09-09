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
 * `defineMessages` means by a message name — taken from the value the payload
 * pins the discriminator to, and falling back to the AsyncAPI message name only
 * when the payload pins nothing. A message that cannot be given a legal key or a
 * legal payload is left out and its reason recorded in
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
 * - **The tag.** The key is the value a frame carries on the wire, which the
 *   payload usually states itself as `type: { const: 'bot_added' }`; that
 *   value is taken as the key and stripped out of the payload (see
 *   {@link stripDiscriminator}), because the runtime removes it from the frame
 *   before validating. Only a payload that pins nothing falls back to the
 *   message's name.
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
  // Maps, not object literals: the keys are wire tags read out of the document,
  // and `target[tag] = schema` on a plain object treats `__proto__` as the
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

    const target = message.direction === 'receive' ? clientToServer : serverToClient
    const half = message.direction === 'receive' ? 'clientToServer' : 'serverToClient'

    /** Files one message under the tag a frame carries, or says why it cannot. */
    const place = (key: string, schema: Record<string, unknown>): void => {
      // The one key that survives this map but not the file written from it: in
      // generated source `{ "__proto__": … }` sets the prototype rather than
      // declaring a message, and no quoting escapes that — only a computed key
      // would, which is not what the emitted literal is. A contract that has to
      // round-trip through source cannot carry a key source cannot express.
      if (key === '__proto__') {
        skip('the wire tag "__proto__" cannot be written as an object key in the generated contract')
        return
      }
      if (target.has(key)) {
        // Two messages tagged alike travel as one frame shape, and only one of
        // them can describe it. Real documents do this: Slack's RTM API
        // declares two messages for its single `bot_added` event.
        skip(`two ${half} messages carry the wire tag "${key}"; keeping the first`)
        return
      }
      target.set(key, schema)
    }

    // No payload at all is not a problem to report: plenty of signals are the
    // tag and nothing else (`{"type":"goodbye"}`). Dropping such a message
    // would be the real damage — the contract is a closed set, so an omitted
    // message means a legitimate frame gets closed as `unknown-type`. There is
    // also nothing to read a tag off, so the message name stands in — and a
    // fresh object each time, since these end up in a shared contract callers
    // are free to read and one mutated literal must not reshape the rest.
    if (message.payload === undefined) {
      place(message.name, { type: 'object' })
      continue
    }

    const projected = stripDiscriminator(message.payload, discriminator)
    if (projected.issue !== undefined) {
      skip(projected.issue)
      continue
    }
    place(projected.tag ?? message.name, projected.schema)
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
