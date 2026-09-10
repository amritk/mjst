import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { type AsyncApiVersion, asyncApiSchemaVersion, loadAsyncApiSchema } from '../schemas'
import { isObject, mergeTraits } from './helpers'
import { type MultiFormatSchema, splitMultiFormatSchema } from './multi-format-schema'
import { isAsyncApiSchemaFormat } from './schema-format'

// The AsyncAPI Schema Object is defined inside each version's own meta-schema,
// as a subschema with its own `$id`. Validating a payload against it means
// pointing a one-key schema at that `$id` and carrying the meta-schema's
// `definitions` along, so the reference — and everything it reaches — resolves
// inside the same document with nothing fetched.
//
// The `.0` is not a guess: the spec publishes one schema per minor and stamps
// its `$id`s with the `x.y.0` patch, so 2.6 and 2.6.4 documents share
// `.../2.6.0/schema.json`. `aas-functions.test.ts` checks that every bundled
// version really declares the id this builds.
const payloadSchemaId = (version: AsyncApiVersion): string => `http://asyncapi.com/definitions/${version}.0/schema.json`

// Keyed by version so each wrapper is built once and stays referentially stable,
// which is what keeps the `schema` function's validator cache warm.
const payloadSchemas = new Map<AsyncApiVersion, object>()

const payloadSchema = (version: AsyncApiVersion): object => {
  let wrapper = payloadSchemas.get(version)
  if (!wrapper) {
    const meta = loadAsyncApiSchema(version) as { definitions?: unknown }
    wrapper = { $ref: payloadSchemaId(version), definitions: meta.definitions }
    payloadSchemas.set(version, wrapper)
  }
  return wrapper
}

/**
 * Validates a message's `payload` against the AsyncAPI Schema Object definition
 * of the document's own version — the check that catches a payload using a JSON
 * Schema keyword AsyncAPI does not allow, or a `type` that is not a type.
 *
 * Takes the whole message rather than the payload so that traits are folded in
 * before the `schemaFormat` is read. A payload in Avro or Protobuf is not an
 * AsyncAPI Schema Object at all, and a `schemaFormat` naming one of those can be
 * contributed by a trait — invisible to a `given` filter, which is how an Avro
 * payload came to be judged as JSON Schema and reported at error severity.
 * `asyncapi-payload-unsupported-schemaFormat` reports those separately.
 */
/** Options for {@link asyncApiPayload}. */
export type IAsyncApiPayloadOptions = {
  /**
   * Whether the payload may be a Multi Format Schema Object (`{ schemaFormat,
   * schema }`). That shape is 3.0 only: the format that used to sit on the
   * message now sits on the payload, so the gate reads a different place — and
   * the schema to judge lives one level further down.
   */
  multiFormat?: boolean
}

export const asyncApiPayload: RulesetFunction<unknown, IAsyncApiPayloadOptions | undefined> = (
  message,
  options,
  context,
): IFunctionResult[] => {
  if (!isObject(message)) return []
  const merged = mergeTraits(message)
  const written = merged['payload']
  if (written === undefined) return []

  const payload: MultiFormatSchema =
    options?.multiFormat === true
      ? splitMultiFormatSchema(written)
      : { schemaFormat: merged['schemaFormat'], schema: written, path: [] }
  if (!isAsyncApiSchemaFormat(payload.schemaFormat)) return []

  const version = asyncApiSchemaVersion(isObject(context.document.data) ? context.document.data['asyncapi'] : undefined)
  if (version === undefined) return []
  return (
    schemaFunction(
      payload.schema,
      { schema: payloadSchema(version), allErrors: true },
      { ...context, path: [...context.path, 'payload', ...payload.path] },
    ) ?? []
  )
}
