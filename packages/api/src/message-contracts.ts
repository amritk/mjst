import type { FromSchema, Validator } from '@amritk/runtime-validators'
import { validate } from '@amritk/runtime-validators'

/**
 * A map of message name → JSON Schema for that message's payload.
 *
 * The key is the message's identity on the wire: it is the value the
 * discriminator property carries, so `{ say: saySchema }` describes the
 * message `{ type: 'say', … }`.
 */
export type MessageSchemas = { readonly [name: string]: unknown }

/**
 * What flows over a realtime connection, declared once for both ends.
 *
 * Two things a request/response contract cannot say, and a socket needs said:
 * **which direction** a message travels, and **which message it is**. HTTP
 * answers both structurally — a request is a request, and `method + path`
 * names the operation — but a socket carries two independent flows of
 * interchangeable frames, so both have to be written down.
 *
 * Directions are named for their endpoints rather than for the reader
 * (`send`/`receive`, `inbound`/`outbound`) because the same declaration is
 * read from both ends: `serverToClient` means the same thing in a handler and
 * in a browser, where "send" inverts between them. AsyncAPI renamed its
 * `publish`/`subscribe` pair in 3.0 for exactly this reason; naming the
 * endpoints sidesteps the question permanently.
 */
export type MessagesContract<
  ClientToServer extends MessageSchemas = MessageSchemas,
  ServerToClient extends MessageSchemas = MessageSchemas,
  Discriminator extends string = string,
> = {
  /**
   * The property naming which message a frame is. Defaults to `'type'`.
   *
   * A discriminator is not optional the way it is in a documentation format.
   * AsyncAPI lists a channel's possible messages and stops there, leaving a
   * consumer to work out which one arrived; code cannot stop there, because
   * "validate this against one of five schemas" has no answer for *which*
   * failure to report when none match.
   */
  readonly discriminator?: Discriminator
  /** Messages the client may send, and the server therefore validates. */
  readonly clientToServer?: ClientToServer
  /** Messages the server may send, and the client therefore validates. */
  readonly serverToClient?: ServerToClient
}

/** Any messages contract, with its schema types erased. */
export type AnyMessagesContract = MessagesContract<MessageSchemas, MessageSchemas, string>

/**
 * The discriminator a contract uses — its declared one, or `'type'`.
 *
 * The tuple wrapper keeps the conditional from distributing, and makes an
 * omitted property resolve to the default rather than to `string`.
 */
export type DiscriminatorOf<M extends AnyMessagesContract> = [M['discriminator']] extends [undefined]
  ? 'type'
  : NonNullable<M['discriminator']>

/** Collapses an intersection into one object, so hovering a message reads as one shape. */
type Flatten<T> = { [Key in keyof T]: T[Key] }

/**
 * The tagged union of one direction's messages: each payload type carrying its
 * discriminator literal, so `switch (message.type)` narrows.
 *
 * Written as a distributive conditional rather than the shorter
 * `{ [N in keyof S]: … }[keyof S]` lookup. The lookup form does not force
 * per-key evaluation here: `FromSchema` ends up applied to the *union* of the
 * schemas, and since a property present in one message and absent from another
 * has no common type, every field collapses to `never` and the union becomes
 * one merged object that narrows to nothing. Distributing over the key
 * explicitly evaluates each message against its own schema.
 */
export type MessageUnion<Schemas, Discriminator extends string> = keyof Schemas & string extends infer Name
  ? Name extends keyof Schemas & string
    ? Flatten<FromSchema<Schemas[Name]> & { readonly [P in Discriminator]: Name }>
    : never
  : never

/**
 * What the client may send / the server receives, as a tagged union.
 *
 * Indexed access rather than `M extends { clientToServer: infer S }`: the
 * direction properties are optional, and an optional property never satisfies
 * a required one in a conditional, so the `infer` form silently resolves to
 * `never` for every real contract.
 */
export type ClientToServerMessage<M extends AnyMessagesContract> = MessageUnion<
  NonNullable<M['clientToServer']>,
  DiscriminatorOf<M>
>

/** What the server may send / the client receives, as a tagged union. */
export type ServerToClientMessage<M extends AnyMessagesContract> = MessageUnion<
  NonNullable<M['serverToClient']>,
  DiscriminatorOf<M>
>

/**
 * Declares a messages contract — pure data, no handler, browser-safe.
 *
 * Like `defineContract`, an identity function whose `const` type parameters
 * capture the schema literals so everything derived from them stays exact.
 * Attach the result to a route's `messages` field, or pass it straight to
 * `bindMessages` / `connectMessages`.
 *
 * @example
 * ```typescript
 * export const chatMessages = defineMessages({
 *   clientToServer: {
 *     say: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
 *   },
 *   serverToClient: {
 *     said: {
 *       type: 'object',
 *       properties: { from: { type: 'string' }, text: { type: 'string' } },
 *       required: ['from', 'text'],
 *     },
 *   },
 * })
 * ```
 */
export const defineMessages = <
  const ClientToServer extends MessageSchemas = MessageSchemas,
  const ServerToClient extends MessageSchemas = MessageSchemas,
  const Discriminator extends string = 'type',
>(
  contract: MessagesContract<ClientToServer, ServerToClient, Discriminator>,
): MessagesContract<ClientToServer, ServerToClient, Discriminator> => contract

/** The default discriminator property, used when a contract declares none. */
export const DEFAULT_DISCRIMINATOR = 'type'

/**
 * One direction's prepared validators, keyed by message name.
 */
export type PreparedDirection = ReadonlyMap<string, Validator>

/**
 * A contract's validators, prepared once and shared by every connection.
 */
export type PreparedMessages = {
  readonly discriminator: string
  readonly clientToServer: PreparedDirection
  readonly serverToClient: PreparedDirection
}

// Keyed on the contract object, so a thousand sockets sharing one contract
// walk the schemas once. The interpreter memoizes per schema object underneath,
// so this mostly saves the per-connection map building and the setup-time
// checks below.
const prepared = new WeakMap<object, PreparedMessages>()

/**
 * Prepares a contract's validators, memoized per contract object.
 *
 * Throws on a schema this cannot enforce as a message — one that is not an
 * object schema, or one that declares the discriminator itself. Both are
 * caught at setup time, because the alternative is a socket that opens fine
 * and closes on its first frame in production.
 */
export const prepareMessages = (contract: AnyMessagesContract): PreparedMessages => {
  const cached = prepared.get(contract)
  if (cached !== undefined) return cached

  const discriminator = contract.discriminator ?? DEFAULT_DISCRIMINATOR
  const built: PreparedMessages = {
    discriminator,
    clientToServer: prepareDirection(contract.clientToServer, discriminator, 'clientToServer'),
    serverToClient: prepareDirection(contract.serverToClient, discriminator, 'serverToClient'),
  }
  prepared.set(contract, built)
  return built
}

const prepareDirection = (
  schemas: MessageSchemas | undefined,
  discriminator: string,
  direction: string,
): PreparedDirection => {
  const validators = new Map<string, Validator>()
  if (schemas === undefined) return validators
  for (const [name, schema] of Object.entries(schemas)) {
    assertMessageSchema(schema, discriminator, name, direction)
    validators.set(name, validate(schema))
  }
  return validators
}

/**
 * Refuses, at setup time, a schema that cannot describe a message.
 *
 * A message schema describes the **payload**; the discriminator is not part of
 * it and is stripped before validation (see `parseMessage`). That split is what
 * lets a composed schema work at all. The earlier design folded the tag into a
 * copy of the schema instead, which held only for a plain object schema: a
 * `$ref`, or an `allOf` branch carrying `additionalProperties: false`, closes
 * over properties this layer cannot reach, so the injected tag was rejected by
 * the very schema it was injected into and a valid frame closed the socket
 * with 1007. No schema-level trick fixes that — a closed subschema will always
 * refuse an extra property — so the tag stays out of the payload entirely.
 *
 * What is still refusable here is a schema that could never match an object,
 * and one that declares the discriminator itself: the latter is now
 * unsatisfiable, since the property it describes is removed before the
 * validator ever sees the value.
 */
export const assertMessageSchema = (
  schema: unknown,
  discriminator: string,
  name: string,
  direction = 'messages',
): void => {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    throw new Error(`${direction}.${name}: a message schema must be an object schema, so the discriminator has a home`)
  const source = schema as Record<string, unknown>
  if (source['type'] !== undefined && source['type'] !== 'object')
    throw new Error(`${direction}.${name}: a message schema must be type 'object', not '${String(source['type'])}'`)

  // Only the top level is checked. A `$ref` or `allOf` branch declaring the
  // discriminator is unreachable from here without resolving refs, which this
  // package leaves to `@amritk/resolve-refs` — and such a schema fails safe:
  // the stripped payload simply misses a property it required, which surfaces
  // as an ordinary `invalid-payload` naming the field.
  const properties = source['properties']
  const declaresProperty =
    typeof properties === 'object' && properties !== null && Object.hasOwn(properties, discriminator)
  const required = Array.isArray(source['required']) ? source['required'] : []
  if (declaresProperty || required.includes(discriminator))
    throw new Error(
      `${direction}.${name}: a message schema must not declare '${discriminator}' — it is the discriminator, ` +
        'supplied by the message name and removed before the payload is validated. Describe the payload only, ' +
        "or rename the property with `discriminator: '…'`.",
    )
}
