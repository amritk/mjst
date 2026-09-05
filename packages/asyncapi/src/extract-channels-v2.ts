import { getMjstDiscriminator } from '@amritk/helpers/mjst-extension'
import { readKey } from '@amritk/helpers/read-key'

import { mergeTraits } from './merge-traits'
import { normalizeMessage } from './normalize-message'
import { resolveNode } from './resolve-pointer'
import type { ExtractionIssue, MessageDirection, NormalizedChannel, NormalizedMessage } from './types'

/**
 * Resolves a message's `traits` list to plain records, dropping (with an
 * issue) any entry that does not dereference.
 */
const resolveTraits = (
  document: unknown,
  traits: unknown,
  issues: ExtractionIssue[],
  path: string,
): Record<string, unknown>[] => {
  if (!Array.isArray(traits)) return []
  const resolved: Record<string, unknown>[] = []
  for (const [index, trait] of traits.entries()) {
    const node = resolveNode(document, trait, issues, `${path}/traits/${index}`)
    if (node !== undefined) resolved.push(node)
  }
  return resolved
}

/**
 * Walks an AsyncAPI 2.x document's channels into the normalized model.
 *
 * Directions are mapped to the application's point of view: `publish` declares
 * what clients publish — so the application *receives* it — and `subscribe`
 * declares what it *sends*. A channel's key doubles as its address; 2.x has no
 * separate `address` field.
 *
 * `schemaFormat` is read off the message only *after* trait merging, so a
 * trait-contributed format gates its payload exactly like an inline one.
 * Message names follow `name` → `messageId` → positional `message-<n>`, the
 * `n` counting across both operations of the channel so a `oneOf` list and a
 * publish/subscribe pair cannot collide.
 */
export const extractChannelsV2 = (
  document: Record<string, unknown>,
  issues: ExtractionIssue[],
): NormalizedChannel[] => {
  const channelsMap = readKey(document, 'channels')
  if (typeof channelsMap !== 'object' || channelsMap === null) return []
  const defaultContentType = readKey(document, 'defaultContentType')

  const channels: NormalizedChannel[] = []
  for (const [channelKey, rawChannel] of Object.entries(channelsMap as Record<string, unknown>)) {
    const channelPath = `#/channels/${channelKey}`
    const channel = resolveNode(document, rawChannel, issues, channelPath)
    if (channel === undefined) continue

    const messages: NormalizedMessage[] = []
    let positional = 0

    for (const operationKey of ['publish', 'subscribe'] as const) {
      const operation = readKey(channel, operationKey)
      if (typeof operation !== 'object' || operation === null) continue
      const direction: MessageDirection = operationKey === 'publish' ? 'receive' : 'send'
      const operationPath = `${channelPath}/${operationKey}`

      // `message` is optional on a 2.x operation (an operation can exist just
      // to carry an operationId or bindings) — its absence is not a problem.
      const rawMessage = readKey(operation as Record<string, unknown>, 'message')
      if (rawMessage === undefined) continue
      const messageNode = resolveNode(document, rawMessage, issues, `${operationPath}/message`)
      if (messageNode === undefined) continue

      // A `oneOf` message lists alternatives; anything else is one message.
      const oneOf = readKey(messageNode, 'oneOf')
      const items = Array.isArray(oneOf) ? oneOf : [messageNode]

      for (const [index, item] of items.entries()) {
        const itemPath = Array.isArray(oneOf) ? `${operationPath}/message/oneOf/${index}` : `${operationPath}/message`
        const resolved = resolveNode(document, item, issues, itemPath)
        if (resolved === undefined) continue

        // 2.x: the trait is the merge patch, so a trait-set key overrides the
        // message's own — the opposite of 3.0, which is why this is spelled out.
        const merged = mergeTraits(
          resolved,
          resolveTraits(document, readKey(resolved, 'traits'), issues, itemPath),
          'trait',
        )
        positional++
        const declaredName = readKey(merged, 'name')
        const messageId = readKey(merged, 'messageId')
        const name =
          typeof declaredName === 'string' && declaredName !== ''
            ? declaredName
            : typeof messageId === 'string' && messageId !== ''
              ? messageId
              : `message-${positional}`
        const contentType = readKey(merged, 'contentType') ?? defaultContentType

        messages.push(
          normalizeMessage(
            {
              name,
              channelKey,
              direction,
              ...(typeof contentType === 'string' ? { contentType } : {}),
              payloadSchemaFormat: readKey(merged, 'schemaFormat'),
              payload: readKey(merged, 'payload'),
              headers: readKey(merged, 'headers'),
            },
            document,
            issues,
            itemPath,
          ),
        )
      }
    }

    const discriminator = getMjstDiscriminator(channel)
    channels.push({
      key: channelKey,
      address: channelKey,
      ...(discriminator !== undefined ? { discriminator } : {}),
      messages,
    })
  }

  return channels
}
