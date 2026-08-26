/**
 * The normalized shape both AsyncAPI majors are extracted into.
 *
 * The model is 3.0-shaped: 2.x documents are mapped onto it during extraction
 * (`publish`/`subscribe` become `receive`/`send`, sibling `schemaFormat` keys
 * become per-schema classifications) so every consumer sees one structure
 * regardless of which major the author wrote.
 */

/**
 * A problem found while extracting, tied to the document location it was found
 * at. Issues are collected rather than thrown: a document with one Avro payload
 * still yields every JSON-Schema payload it declares, and the caller decides
 * whether the skipped parts are worth failing over.
 */
export type ExtractionIssue = {
  /** JSON-Pointer-ish location of the problem (e.g. `#/channels/foo/messages/bar`). */
  readonly path: string
  readonly message: string
}

/**
 * Which way a message flows, named from the application's point of view — the
 * same convention `@amritk/api` uses. AsyncAPI 2.x's `publish` (clients
 * publish, the application receives) maps to `receive`; `subscribe` maps to
 * `send`; 3.0's `action` is already spelled this way.
 */
export type MessageDirection = 'send' | 'receive'

/** One message on a channel, its schemas already normalized to JSON Schema 2020-12. */
export type NormalizedMessage = {
  /**
   * The message's identity: the 3.0 channel-messages key, or in 2.x the
   * message `name`, falling back to `messageId` and then a positional
   * `message-<n>`. Doubles as the wire discriminator value in a later
   * message-contract projection.
   */
  readonly name: string
  /** Key of the channel the message was declared on. */
  readonly channelKey: string
  /** Absent when no operation names the message, so its flow is undeclared. */
  readonly direction?: MessageDirection
  readonly contentType?: string
  /**
   * The declared payload `schemaFormat`, kept verbatim (absent = the AsyncAPI
   * default dialect) so a consumer can see *why* a payload was or was not
   * extracted.
   */
  readonly schemaFormat?: string
  /**
   * The payload as a self-contained JSON Schema 2020-12 document: the dialect
   * normalized, and every `#/components/schemas/...` reference rebased into a
   * local `$defs`. Absent when the message declares none, or when its
   * `schemaFormat` is not a JSON Schema dialect (an issue records which).
   */
  readonly payload?: Record<string, unknown>
  /** The headers schema, normalized the same way as {@link payload}. */
  readonly headers?: Record<string, unknown>
}

export type NormalizedChannel = {
  /** The channel's key in the document's `channels` map. */
  readonly key: string
  /** The 3.0 `address`; for 2.x the channel key, which *is* the topic/path. */
  readonly address?: string
  readonly messages: readonly NormalizedMessage[]
}

export type AsyncApiModel = {
  /** The declared `asyncapi` version, verbatim (e.g. `2.6.0`, `3.0.0`). */
  readonly version: string
  readonly major: 2 | 3
  /** The document's `info.title`, when it is a string. */
  readonly title?: string
  readonly channels: readonly NormalizedChannel[]
  readonly issues: readonly ExtractionIssue[]
}

/**
 * One generatable schema pulled out of the model: what to hand `buildSchema`
 * and where its output tree belongs, mirroring how `--schema-dir` maps each
 * schema file to its own subdirectory.
 */
export type ExtractedSchema = {
  /** Output subdirectory, e.g. `channels/user-signed-up/user-event`. */
  readonly subDir: string
  /** PascalCase root type name derived from the message identity, not the schema `title`. */
  readonly rootTypeName: string
  readonly schema: Record<string, unknown>
}
