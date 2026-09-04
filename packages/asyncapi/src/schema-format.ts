/**
 * The JSON Schema dialect a `schemaFormat` names, or `'unsupported'` for
 * everything the pipeline cannot turn into JSON Schema (Avro, Protobuf, RAML,
 * unrecognized media types). The four supported families each get their own
 * normalization: the AsyncAPI default dialect and declared draft-07 go through
 * the draft-07 upgrade, OpenAPI schema objects get `nullable` folded, and
 * 2020-12 passes through.
 */
export type SchemaFormatFamily = 'asyncapi' | 'draft-07' | '2020-12' | 'openapi' | 'unsupported'

// The AsyncAPI dialect media type, matched on its `+suffix`/`;parameter`
// boundary — the same anchoring the lint preset uses, so a hypothetical
// `application/vnd.aai.asyncapi-like` type is not claimed.
const ASYNCAPI_DIALECT = /^application\/vnd\.aai\.asyncapi([+;]|$)/
const OPENAPI_DIALECT = /^application\/vnd\.oai\.openapi([+;]|$)/
const JSON_SCHEMA_DIALECT = /^application\/schema\+(?:json|yaml);\s*version=(draft-07|draft-2020-12)\s*$/

/**
 * Classifies a message's effective `schemaFormat`. An absent format means the
 * AsyncAPI default dialect — the spec's own rule — so `undefined` is
 * `'asyncapi'`, while a present-but-non-string value is malformed and lands in
 * `'unsupported'` with everything else the pipeline cannot generate from.
 */
export const classifySchemaFormat = (schemaFormat: unknown): SchemaFormatFamily => {
  if (schemaFormat === undefined) return 'asyncapi'
  if (typeof schemaFormat !== 'string') return 'unsupported'
  if (ASYNCAPI_DIALECT.test(schemaFormat)) return 'asyncapi'
  if (OPENAPI_DIALECT.test(schemaFormat)) return 'openapi'
  const jsonSchema = JSON_SCHEMA_DIALECT.exec(schemaFormat)
  if (jsonSchema) return jsonSchema[1] === 'draft-07' ? 'draft-07' : '2020-12'
  return 'unsupported'
}
