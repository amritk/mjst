import { type AvroEncoding, avroToJsonSchema } from '@amritk/adapters/avro-to-json-schema'

import { normalizeSchema } from './normalize-schema'
import { rebaseComponentRefs } from './rebase-component-refs'
import { classifySchemaFormat } from './schema-format'
import type { ExtractionIssue, MessageDirection, NormalizedMessage } from './types'

/** Knobs the version walkers pass straight through from `extractAsyncApi`. */
export type NormalizeMessageOptions = {
  /**
   * Which JSON shape an Avro payload is converted into. `'json'` (the default)
   * describes the decoded object an application works with, which is what the
   * generators exist to produce; `'avro-json'` describes the spec's JSON
   * encoding — the bytes that actually travel under
   * `application/vnd.apache.avro+json`, with unions wrapped in their branch
   * name. Pick the wire shape only if you are validating raw frames.
   */
  readonly avroEncoding?: AvroEncoding
}

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
 * An Avro `schemaFormat` is converted rather than refused: Avro is a schema
 * language `@amritk/adapters` already reads, and the whole point of the
 * extraction layer is to hand the generators JSON Schema whatever the document
 * wrote. A conversion that fails — an illegal Avro name, a construct with no
 * JSON Schema reading — becomes an issue rather than an exception, so one bad
 * record schema costs only its own message.
 *
 * A schema whose format is neither a JSON Schema dialect nor Avro — Protobuf, a
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
  options: NormalizeMessageOptions = {},
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
    if (family === 'avro') {
      try {
        // Avro schemas are self-contained by construction — every named type is
        // defined inline or by an earlier definition — so there is nothing here
        // for `rebaseComponentRefs` to pull in, and the adapter already emits
        // 2020-12 with its own local `$defs`.
        return avroToJsonSchema(value, { encoding: options.avroEncoding ?? 'json' }) as Record<string, unknown>
      } catch (error) {
        issues.push({
          path: `${path}/${label}`,
          message: `skipped: Avro ${label} could not be converted (${error instanceof Error ? error.message : String(error)})`,
        })
        return undefined
      }
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
