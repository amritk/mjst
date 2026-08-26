export { type DetectedVersion, detectAsyncApiVersion } from './detect-version'
export { extractAsyncApi } from './extract-async-api'
export { mergeTraits } from './merge-traits'
export { listMessageSchemas } from './message-schemas'
export { classifySchemaFormat, type SchemaFormatFamily } from './schema-format'
export type {
  AsyncApiModel,
  ExtractedSchema,
  ExtractionIssue,
  MessageDirection,
  NormalizedChannel,
  NormalizedMessage,
} from './types'
