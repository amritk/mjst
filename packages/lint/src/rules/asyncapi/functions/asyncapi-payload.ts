import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { type AsyncApiVersion, asyncApiSchemaVersion, loadAsyncApiSchema } from '../schemas'
import { isObject, mergeTraits } from './helpers'
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
export const asyncApiPayload: RulesetFunction = (message, _options, context): IFunctionResult[] => {
  if (!isObject(message)) return []
  const merged = mergeTraits(message)
  if (!isAsyncApiSchemaFormat(merged['schemaFormat'])) return []
  const payload = merged['payload']
  if (payload === undefined) return []

  const version = asyncApiSchemaVersion(isObject(context.document.data) ? context.document.data['asyncapi'] : undefined)
  if (version === undefined) return []
  return (
    schemaFunction(
      payload,
      { schema: payloadSchema(version), allErrors: true },
      { ...context, path: [...context.path, 'payload'] },
    ) ?? []
  )
}
