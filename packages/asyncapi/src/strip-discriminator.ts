import { readKey } from '@amritk/helpers/read-key'

/**
 * Either a payload schema fit to stand as a message schema — with the wire tag
 * it declared, when it declared one — or the reason it is not. Never both: a
 * message whose payload cannot be made contract-legal is skipped with the
 * issue, rather than emitted as something that would throw at
 * `prepareMessages` time or reject every frame at runtime.
 */
export type StripDiscriminatorResult =
  | {
      readonly schema: Record<string, unknown>
      /**
       * The value the payload pinned the discriminator to, which *is* the
       * frame's tag on the wire. Absent when the payload never mentions the
       * discriminator, leaving the caller to fall back to the message name.
       */
      readonly tag?: string
      readonly issue?: undefined
    }
  | { readonly schema?: undefined; readonly tag?: undefined; readonly issue: string }

/** The single value a schema branch pins its instance to, via `const` or a one-member `enum`. */
const pinnedValue = (branch: Record<string, unknown>): { readonly value: unknown } | undefined => {
  if (Object.hasOwn(branch, 'const')) return { value: readKey(branch, 'const') }
  const enumValue = readKey(branch, 'enum')
  if (Array.isArray(enumValue) && enumValue.length === 1) return { value: enumValue[0] }
  return undefined
}

/**
 * Removes the discriminator property from a message payload, so what is left
 * describes the payload alone, and reports the tag value the payload pinned it
 * to.
 *
 * `@amritk/api` reads the tag off the frame to *select* the message, then
 * removes it before validating — so a schema that still declares the tag is
 * refused at setup time by `assertMessageSchema`, and would be unsatisfiable
 * even if it were not. AsyncAPI documents, meanwhile, almost always declare it:
 * a channel carrying a `oneOf` of messages has nothing *but* the tag to tell
 * them apart, so `type: { const: 'hello' }` is how the document says "this is
 * the hello message". The two conventions are the same fact written twice, and
 * this reconciles them by taking the document's word for what goes on the wire
 * and dropping the copy.
 *
 * The pinned value is returned rather than checked against the message name,
 * because the two answer different questions. A message's *name* is a
 * document-authoring handle — 2.x messages inside a `oneOf` often have none at
 * all, and get a positional `message-3` — while `const` is a statement about
 * the bytes. Slack's RTM API names a message `botAdded` and tags it
 * `bot_added`; keying on the name would emit a contract listening for a frame
 * that never arrives, so the tag wins and the name is only the fallback for a
 * payload that pins nothing.
 *
 * What is still refused, because no tag can be recovered from it:
 *
 * - `type: { type: 'string' }` constrains the tag without naming a value.
 * - A multi-member `enum` names several, which identifies no single message.
 * - `type: { const: 7 }` names a non-string, and the runtime selects a message
 *   by a string tag — a numeric one matches no key it could be given.
 * - A payload that is not an object schema has nowhere for a tag to live, which
 *   `assertMessageSchema` refuses too.
 *
 * The input is never mutated: the model's schemas are shared with the parser
 * generators, which must keep seeing the payload as the document wrote it.
 */
export const stripDiscriminator = (payload: unknown, discriminator: string): StripDiscriminatorResult => {
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
  // to a component, say) is already exactly what the contract wants, and the
  // caller names it after the message.
  if (declaration === undefined && !requiresDiscriminator) return { schema }

  if (declaration === undefined)
    return {
      issue: `payload requires "${discriminator}" without declaring it, so the tag it carries cannot be read`,
    }

  if (typeof declaration !== 'object' || declaration === null)
    return { issue: `payload declares "${discriminator}" as ${JSON.stringify(declaration)}, not a schema` }

  const pinned = pinnedValue(declaration as Record<string, unknown>)
  if (pinned === undefined)
    return {
      issue:
        `payload constrains "${discriminator}" without pinning it to one value, ` +
        'so the message it tags cannot be identified',
    }
  if (typeof pinned.value !== 'string')
    return {
      issue:
        `payload pins "${discriminator}" to ${JSON.stringify(pinned.value)}, which is not a string; ` +
        'a frame is routed by a string tag, so this one could never select a message',
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

  return { schema: stripped, tag: pinned.value }
}
