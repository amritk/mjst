import { readKey } from '@amritk/helpers/read-key'

import { mergeTraits } from './merge-traits'
import { normalizeMessage } from './normalize-message'
import { resolveNode } from './resolve-pointer'
import type { ExtractionIssue, MessageDirection, NormalizedChannel, NormalizedMessage } from './types'
import { unwrapMultiFormat } from './unwrap-multi-format'

const CHANNEL_REF = /^#\/channels\/([^/]+)$/
const CHANNEL_MESSAGE_REF = /^#\/channels\/([^/]+)\/messages\/([^/]+)$/

/** Unescapes one RFC 6901 pointer segment. */
const decodeSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~')

/**
 * Resolves a pointer segment to a key the map actually holds, or `undefined`.
 * Documents spell segments both raw and percent-encoded (the RFC 3986 form a
 * `$ref` fragment requires for spaces and friends), so when the tilde-decoded
 * segment misses, its percent-decoded form gets a try — an unvalidated fast
 * path returned the undecoded spelling and silently dropped every direction
 * keyed under the real name.
 */
const memberKey = (map: Record<string, unknown>, segment: string): string | undefined => {
  const raw = decodeSegment(segment)
  if (readKey(map, raw) !== undefined) return raw
  if (raw.includes('%')) {
    try {
      const decoded = decodeURIComponent(raw)
      if (readKey(map, decoded) !== undefined) return decoded
    } catch {
      // Not a valid percent sequence — the miss stands.
    }
  }
  return undefined
}

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
 * Reads message directions off the 3.0 `operations` map: each operation names
 * its channel (and optionally a subset of its messages) by `$ref`, and its
 * `action` is already spelled from the application's point of view.
 *
 * References are matched by pointer string first, and by object identity as
 * the fallback: a loader that inlined the document's refs (the cross-file
 * resolver does) replaces the `$ref` node with the very object the channels
 * map holds, so identity still finds the channel when the pointer is gone.
 * Returns a map keyed `channelKey\u0000messageKey`; a message two operations
 * disagree about keeps the first direction, with an issue naming the conflict.
 */
const collectDirections = (
  document: Record<string, unknown>,
  channelsMap: Record<string, unknown>,
  issues: ExtractionIssue[],
): Map<string, MessageDirection> => {
  const directions = new Map<string, MessageDirection>()
  const operationsMap = readKey(document, 'operations')
  if (typeof operationsMap !== 'object' || operationsMap === null) return directions

  const channelKeyOf = (channelNode: unknown, path: string): string | undefined => {
    if (typeof channelNode === 'object' && channelNode !== null) {
      const ref = readKey(channelNode as Record<string, unknown>, '$ref')
      if (typeof ref === 'string') {
        const match = CHANNEL_REF.exec(ref)
        if (match) {
          // Membership-checked: an unverified key silently dropped the
          // direction; a miss falls through to the identity path below.
          const key = memberKey(channelsMap, match[1] as string)
          if (key !== undefined) return key
        }
      }
    }
    // Identity fallback, through resolution on *both* sides: the operation may
    // point at `#/components/channels/...` while the channels-map entry is its
    // own ref to the same component — only the resolved objects coincide. A
    // scratch issue list keeps these probes quiet; the caller reports the one
    // real failure when no channel matches.
    const scratch: ExtractionIssue[] = []
    const resolved = resolveNode(document, channelNode, scratch, path)
    if (resolved !== undefined) {
      for (const [key, value] of Object.entries(channelsMap)) {
        if (value === channelNode || value === resolved) return key
        if (resolveNode(document, value, scratch, path) === resolved) return key
      }
    }
    return undefined
  }

  for (const [operationKey, rawOperation] of Object.entries(operationsMap as Record<string, unknown>)) {
    const operationPath = `#/operations/${operationKey}`
    const operation = resolveNode(document, rawOperation, issues, operationPath)
    if (operation === undefined) continue
    const action = readKey(operation, 'action')
    if (action !== 'send' && action !== 'receive') continue

    const channelKey = channelKeyOf(readKey(operation, 'channel'), `${operationPath}/channel`)
    if (channelKey === undefined) {
      issues.push({
        path: `${operationPath}/channel`,
        message: 'operation channel does not resolve; direction skipped',
      })
      continue
    }

    const channel = resolveNode(document, readKey(channelsMap, channelKey), issues, `#/channels/${channelKey}`)
    const channelMessages = channel === undefined ? undefined : readKey(channel, 'messages')

    // With no `messages` list the operation covers the whole channel.
    const opMessages = readKey(operation, 'messages')
    const messageKeys: string[] = []
    if (Array.isArray(opMessages)) {
      for (const [index, item] of opMessages.entries()) {
        const ref =
          typeof item === 'object' && item !== null ? readKey(item as Record<string, unknown>, '$ref') : undefined
        const match = typeof ref === 'string' ? CHANNEL_MESSAGE_REF.exec(ref) : null
        if (match && typeof channelMessages === 'object' && channelMessages !== null) {
          const key = memberKey(channelMessages as Record<string, unknown>, match[2] as string)
          if (key !== undefined) {
            messageKeys.push(key)
            continue
          }
          // A key the channel does not hold falls through to the identity path.
        }
        // Any other spelling (`#/components/messages/...`, or a node a
        // resolver inlined): find the message by identity in the channel's
        // map, resolving both sides so two refs to the same component match.
        let found = false
        if (typeof channelMessages === 'object' && channelMessages !== null) {
          const scratch: ExtractionIssue[] = []
          const itemPath = `${operationPath}/messages/${index}`
          const resolvedItem = resolveNode(document, item, scratch, itemPath)
          for (const [key, value] of Object.entries(channelMessages as Record<string, unknown>)) {
            const matches =
              value === item ||
              (resolvedItem !== undefined &&
                (value === resolvedItem || resolveNode(document, value, scratch, itemPath) === resolvedItem))
            if (matches) {
              messageKeys.push(key)
              found = true
              break
            }
          }
        }
        if (!found) {
          issues.push({
            path: `${operationPath}/messages/${index}`,
            message: 'operation message reference does not resolve to a channel message; direction skipped',
          })
        }
      }
    } else if (typeof channelMessages === 'object' && channelMessages !== null) {
      messageKeys.push(...Object.keys(channelMessages as Record<string, unknown>))
    }

    for (const messageKey of messageKeys) {
      const key = `${channelKey}\u0000${messageKey}`
      const existing = directions.get(key)
      if (existing === undefined) {
        directions.set(key, action)
      } else if (existing !== action) {
        issues.push({
          path: operationPath,
          message: `message "${messageKey}" on channel "${channelKey}" is both sent and received; keeping "${existing}"`,
        })
      }
    }
  }

  return directions
}

/**
 * Walks an AsyncAPI 3.0 document's channels into the normalized model.
 *
 * Payload and headers values may each be a Multi Format Schema Object — 3.0
 * moved `schemaFormat` into that wrapper — so both are unwrapped here and the
 * format travels with the schema it labels. Message names are the channel's
 * `messages` map keys, which 3.0 makes mandatory and unique per channel.
 */
export const extractChannelsV3 = (
  document: Record<string, unknown>,
  issues: ExtractionIssue[],
): NormalizedChannel[] => {
  const channelsMap = readKey(document, 'channels')
  if (typeof channelsMap !== 'object' || channelsMap === null) return []
  const defaultContentType = readKey(document, 'defaultContentType')
  const directions = collectDirections(document, channelsMap as Record<string, unknown>, issues)

  const channels: NormalizedChannel[] = []
  for (const [channelKey, rawChannel] of Object.entries(channelsMap as Record<string, unknown>)) {
    const channelPath = `#/channels/${channelKey}`
    const channel = resolveNode(document, rawChannel, issues, channelPath)
    if (channel === undefined) continue
    const address = readKey(channel, 'address')

    const messages: NormalizedMessage[] = []
    const messagesMap = readKey(channel, 'messages')
    if (typeof messagesMap === 'object' && messagesMap !== null) {
      for (const [messageKey, rawMessage] of Object.entries(messagesMap as Record<string, unknown>)) {
        const messagePath = `${channelPath}/messages/${messageKey}`
        const resolved = resolveNode(document, rawMessage, issues, messagePath)
        if (resolved === undefined) continue

        // 3.0 inverted 2.x's trait precedence: "A property on a trait MUST NOT
        // override the same property on the target object".
        const merged = mergeTraits(
          resolved,
          resolveTraits(document, readKey(resolved, 'traits'), issues, messagePath),
          'target',
        )
        const payload = unwrapMultiFormat(readKey(merged, 'payload'))
        const headers = unwrapMultiFormat(readKey(merged, 'headers'))
        const contentType = readKey(merged, 'contentType') ?? defaultContentType
        const direction = directions.get(`${channelKey}\u0000${messageKey}`)

        messages.push(
          normalizeMessage(
            {
              name: messageKey,
              channelKey,
              ...(direction !== undefined ? { direction } : {}),
              ...(typeof contentType === 'string' ? { contentType } : {}),
              payloadSchemaFormat: payload.schemaFormat,
              payload: payload.schema,
              headersSchemaFormat: headers.schemaFormat,
              headers: headers.schema,
            },
            document,
            issues,
            messagePath,
          ),
        )
      }
    }

    channels.push({
      key: channelKey,
      ...(typeof address === 'string' && address !== '' ? { address } : {}),
      messages,
    })
  }

  return channels
}
