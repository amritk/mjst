import { normalizeSchema } from './normalize-schema'
import { rebaseComponentRefs } from './rebase-component-refs'
import { classifySchemaFormat } from './schema-format'
import type { ExtractionIssue, MessageDirection, NormalizedMessage } from './types'

export type RawMessage = {
  readonly name: string
  readonly channelKey: string
  readonly direction?: MessageDirection
  readonly contentType?: string
  /** The message's effective payload `schemaFormat` (post-trait-merge / unwrapped). */
  readonly payloadSchemaFormat?: unknown
  readonly payload?: unknown
  /**
   * The headers' own format: in 2.x headers are always an AsyncAPI Schema
   * Object whatever the payload declares, while a 3.0 headers value may carry
   * its own Multi Format wrapper — so the two cannot share one field.
   */
  readonly headersSchemaFormat?: unknown
  readonly headers?: unknown
}

/**
 * Turns one raw message (already dereferenced and trait-merged by the version
 * walkers) into a {@link NormalizedMessage}, normalizing its payload and
 * headers into self-contained 2020-12 schemas.
 *
 * A schema whose format is not a JSON Schema dialect — Avro, Protobuf, a
 * malformed value — is skipped with an issue naming the format, keeping the
 * message itself in the model so a consumer can still see it exists. A
 * non-object schema (AsyncAPI allows boolean schemas; the generators need an
 * object root) is skipped the same way.
 */
export const normalizeMessage = (
  raw: RawMessage,
  document: unknown,
  issues: ExtractionIssue[],
  path: string,
): NormalizedMessage => {
  const normalizeOne = (
    value: unknown,
    schemaFormat: unknown,
    label: 'payload' | 'headers',
  ): Record<string, unknown> | undefined => {
    if (value === undefined) return undefined
    const family = classifySchemaFormat(schemaFormat)
    if (family === 'unsupported') {
      issues.push({
        path: `${path}/${label}`,
        message: `skipped: unsupported schemaFormat ${JSON.stringify(schemaFormat)} (not a JSON Schema dialect)`,
      })
      return undefined
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ path: `${path}/${label}`, message: `skipped: ${label} is not an object schema` })
      return undefined
    }
    return rebaseComponentRefs(
      normalizeSchema(value as Record<string, unknown>, family),
      document,
      family,
      issues,
      `${path}/${label}`,
    )
  }

  const payload = normalizeOne(raw.payload, raw.payloadSchemaFormat, 'payload')
  const headers = normalizeOne(raw.headers, raw.headersSchemaFormat, 'headers')

  return {
    name: raw.name,
    channelKey: raw.channelKey,
    ...(raw.direction !== undefined ? { direction: raw.direction } : {}),
    ...(raw.contentType !== undefined ? { contentType: raw.contentType } : {}),
    ...(typeof raw.payloadSchemaFormat === 'string' ? { schemaFormat: raw.payloadSchemaFormat } : {}),
    ...(payload !== undefined ? { payload } : {}),
    ...(headers !== undefined ? { headers } : {}),
  }
}
