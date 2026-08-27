import { toKebabCase } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'

import type { AsyncApiModel, ExtractedSchema, ExtractionIssue } from './types'

/**
 * Folds an arbitrary channel key or message name into a filesystem- and
 * import-safe kebab token: camelCase splits, and everything a filename cannot
 * carry — a topic's `/` separators, `{param}` braces, spaces — becomes a
 * dash. `fallback` covers the value that normalizes away entirely.
 */
const sanitizeToken = (value: string, fallback: string): string => {
  const token = toKebabCase(value)
    .replace(/[^\p{ID_Continue}.]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return token === '' ? fallback : token
}

/**
 * Claims a unique token: the sanitized name when it is free, else the first
 * free `-2`, `-3`, … suffix. Two distinct channels (or two messages on one
 * channel) whose names sanitize identically must not share an output tree —
 * and documents in the wild do collide, so this dedupes deterministically
 * (with an issue) rather than throwing.
 */
const claimToken = (base: string, taken: Set<string>, issues: ExtractionIssue[], path: string): string => {
  let token = base
  for (let n = 2; taken.has(token); n++) {
    token = `${base}-${n}`
  }
  if (token !== base) {
    issues.push({ path, message: `output name "${base}" already claimed; using "${token}"` })
  }
  taken.add(token)
  return token
}

/**
 * Claims a message token together with its `-headers` shadow. The headers
 * tree is derived, not claimed by name, so without reserving both slots a
 * message literally named `foo-headers` landed in the same directory as
 * `foo`'s headers tree — two schemas silently sharing one output. Both slots
 * are reserved whether or not this message carries headers: a later sibling
 * must not claim a directory an earlier message's derivation already implies.
 */
const claimMessageToken = (base: string, taken: Set<string>, issues: ExtractionIssue[], path: string): string => {
  let token = base
  for (let n = 2; taken.has(token) || taken.has(`${token}-headers`); n++) {
    token = `${base}-${n}`
  }
  if (token !== base) {
    issues.push({ path, message: `output name "${base}" already claimed; using "${token}"` })
  }
  taken.add(token)
  taken.add(`${token}-headers`)
  return token
}

/**
 * Flattens the model into the list of generatable schemas, each with the
 * output subdirectory and root type name the CLI hands to `buildSchema` —
 * `channels/<channel>/<message>/` per payload, with headers in a sibling
 * `<message>-headers/` tree, mirroring how `--schema-dir` gives every schema
 * its own directory.
 *
 * The root type name comes from the message identity (`LightMeasured`), never
 * the schema's `title`: two messages titled "Event" are distinct messages, and
 * the directory layout already says which is which. Messages without a usable
 * payload or headers schema (skipped formats, absent payloads) contribute
 * nothing here — their issues already sit on the model.
 *
 * Name collisions append to `issues`, which the model shares by reference —
 * callers reading `model.issues` after this call see them; pass an array to
 * collect them separately.
 */
export const listMessageSchemas = (model: AsyncApiModel, issues?: ExtractionIssue[]): ExtractedSchema[] => {
  const collected = issues ?? (model.issues as ExtractionIssue[])
  const schemas: ExtractedSchema[] = []
  const channelTokens = new Set<string>()

  for (const channel of model.channels) {
    const channelToken = claimToken(
      sanitizeToken(channel.key, 'channel'),
      channelTokens,
      collected,
      `#/channels/${channel.key}`,
    )
    const messageTokens = new Set<string>()

    for (const message of channel.messages) {
      if (message.payload === undefined && message.headers === undefined) continue
      const messageToken = claimMessageToken(
        sanitizeToken(message.name, 'message'),
        messageTokens,
        collected,
        `#/channels/${channel.key}/messages/${message.name}`,
      )
      const rootTypeName = refToName(messageToken)

      if (message.payload !== undefined) {
        schemas.push({
          subDir: `channels/${channelToken}/${messageToken}`,
          rootTypeName,
          schema: message.payload,
        })
      }
      if (message.headers !== undefined) {
        schemas.push({
          subDir: `channels/${channelToken}/${messageToken}-headers`,
          rootTypeName: `${rootTypeName}Headers`,
          schema: message.headers,
        })
      }
    }
  }

  return schemas
}
