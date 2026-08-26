import { readKey } from '@amritk/helpers/read-key'

import { detectAsyncApiVersion } from './detect-version'
import { extractChannelsV2 } from './extract-channels-v2'
import { extractChannelsV3 } from './extract-channels-v3'
import type { AsyncApiModel, ExtractionIssue } from './types'

/**
 * Extracts an already-parsed AsyncAPI document (2.x or 3.x) into the
 * normalized model: channels, their messages, and each message's payload and
 * headers as self-contained JSON Schema 2020-12 documents.
 *
 * Per-message problems — an Avro payload, a dangling `$ref`, a malformed
 * trait — are collected on `issues` so one bad message never costs the rest of
 * the document. Only a document that is not AsyncAPI at all throws: there is
 * nothing to extract, and a silent empty model would read as "no channels"
 * rather than "wrong file".
 */
export const extractAsyncApi = (document: unknown): AsyncApiModel => {
  const detected = detectAsyncApiVersion(document)
  if (!detected) {
    throw new Error('Not an AsyncAPI document: expected a top-level `asyncapi` field declaring version 2.x or 3.x.')
  }

  const record = document as Record<string, unknown>
  const issues: ExtractionIssue[] = []
  const channels = detected.major === 2 ? extractChannelsV2(record, issues) : extractChannelsV3(record, issues)

  const info = readKey(record, 'info')
  const title =
    typeof info === 'object' && info !== null ? readKey(info as Record<string, unknown>, 'title') : undefined

  return {
    version: detected.version,
    major: detected.major,
    ...(typeof title === 'string' ? { title } : {}),
    channels,
    issues,
  }
}
