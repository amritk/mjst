/**
 * The media types that name the AsyncAPI Schema Object dialect — the language a
 * payload is written in when `schemaFormat` is omitted. The spec lets an author
 * state the default explicitly (`application/vnd.aai.asyncapi;version=2.6.0`,
 * and the `+json` / `+yaml` variants), so a payload naming one of these is the
 * same language as a payload naming nothing and gets the same validation.
 * Treating only the absent case as default meant that writing the spec's own
 * default silently switched payload checking off.
 */
const ASYNCAPI_DIALECT = /^application\/vnd\.aai\.asyncapi([+;])/

/** True when a `schemaFormat` names the AsyncAPI Schema Object dialect, or is absent. */
export const isAsyncApiSchemaFormat = (schemaFormat: unknown): boolean =>
  schemaFormat === undefined || (typeof schemaFormat === 'string' && ASYNCAPI_DIALECT.test(schemaFormat))

/** The same test as a filter expression, for a rule's `given`. */
export const ASYNCAPI_SCHEMA_FORMAT_FILTER =
  '@.schemaFormat === void 0 || @.schemaFormat.match(/^application\\/vnd\\.aai\\.asyncapi([+;])/)'
