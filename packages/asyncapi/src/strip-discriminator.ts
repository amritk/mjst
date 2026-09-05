import { readKey } from '@amritk/helpers/read-key'

/**
 * Either a payload schema fit to stand as a message schema, or the reason it is
 * not. Never both — a message whose payload cannot be made contract-legal is
 * skipped with the issue, rather than emitted as something that would throw at
 * `prepareMessages` time or reject every frame at runtime.
 */
export type StripDiscriminatorResult =
  | { readonly schema: Record<string, unknown>; readonly issue?: undefined }
  | { readonly schema?: undefined; readonly issue: string }

/** True for a single-member `enum` naming exactly `value` — the pre-`const` spelling. */
const isSingletonEnum = (enumValue: unknown, value: string): boolean =>
  Array.isArray(enumValue) && enumValue.length === 1 && enumValue[0] === value

/**
 * Removes the discriminator property from a message payload, so what is left
 * describes the payload alone.
 *
 * `@amritk/api` reads the tag off the frame to *select* the message, then
 * removes it before validating — so a schema that still declares the tag is
 * refused at setup time by `assertMessageSchema`, and would be unsatisfiable
 * even if it were not. AsyncAPI documents, meanwhile, almost always declare it:
 * a channel carrying a `oneOf` of messages has nothing *but* the tag to tell
 * them apart, so `type: { const: 'hello' }` is how the document says "this is
 * the hello message". The two conventions are the same fact written twice, and
 * this reconciles them by trusting the message name — the key the contract is
 * built on — and dropping the copy.
 *
 * Only a declaration that *agrees* with the message name is dropped. Anything
 * else is an issue rather than a silent rewrite:
 *
 * - `type: { const: 'bot_added' }` on a message named `botChanged` means the
 *   wire tag is not the message name, and stripping it would emit a contract
 *   that quietly listens for the wrong frame. (Real documents do this: Slack's
 *   RTM API names two messages after one `bot_added` event.) Give the channel
 *   an `x-mjst` discriminator naming a different property, or rename the
 *   message to match the tag.
 * - `type: { type: 'string' }` constrains the tag without naming a value, so
 *   nothing here can confirm it ever carries this message's name.
 * - A payload that is not an object schema has nowhere for a tag to live, which
 *   `assertMessageSchema` refuses too.
 *
 * The input is never mutated: the model's schemas are shared with the parser
 * generators, which must keep seeing the payload as the document wrote it.
 */
export const stripDiscriminator = (
  payload: unknown,
  discriminator: string,
  messageName: string,
): StripDiscriminatorResult => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return { issue: 'payload is not an object schema, so it cannot describe a message' }

  const schema = payload as Record<string, unknown>

  // Mirrors `assertMessageSchema`: a message is an object on the wire, because
  // the tag has to sit somewhere. `type: ['object', 'null']` fails this too —
  // the runtime compares against the string, not a set.
  const type = readKey(schema, 'type')
  if (type !== undefined && type !== 'object')
    return { issue: `payload declares type ${JSON.stringify(type)}; a message schema must be type 'object'` }

  const properties = readKey(schema, 'properties')
  const declaredProperties =
    typeof properties === 'object' && properties !== null ? (properties as Record<string, unknown>) : undefined
  const declaration = declaredProperties === undefined ? undefined : readKey(declaredProperties, discriminator)
  const required = readKey(schema, 'required')
  const requiresDiscriminator = Array.isArray(required) && required.includes(discriminator)

  // Nothing to reconcile — a payload that never mentions the tag (a bare `$ref`
  // to a component, say) is already exactly what the contract wants.
  if (declaration === undefined && !requiresDiscriminator) return { schema }

  if (declaration === undefined)
    return {
      issue: `payload requires "${discriminator}" without declaring it, so its value cannot be checked against the message name`,
    }

  if (typeof declaration !== 'object' || declaration === null)
    return { issue: `payload declares "${discriminator}" as ${JSON.stringify(declaration)}, not a schema` }

  const branch = declaration as Record<string, unknown>
  const matchesName = readKey(branch, 'const') === messageName || isSingletonEnum(readKey(branch, 'enum'), messageName)
  if (!matchesName)
    return {
      issue:
        `payload's "${discriminator}" is not pinned to this message's name, ` +
        'so the wire tag and the contract key would disagree',
    }

  const stripped: Record<string, unknown> = { ...schema }
  const remaining = Object.fromEntries(
    Object.entries(declaredProperties as Record<string, unknown>).filter(([key]) => key !== discriminator),
  )
  // An empty `properties`/`required` says nothing, and reads as an oversight in
  // generated output — drop the keyword rather than emit its empty form.
  if (Object.keys(remaining).length === 0) delete stripped['properties']
  else stripped['properties'] = remaining

  if (requiresDiscriminator) {
    const rest = (required as unknown[]).filter((entry) => entry !== discriminator)
    if (rest.length === 0) delete stripped['required']
    else stripped['required'] = rest
  }

  return { schema: stripped }
}
