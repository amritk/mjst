import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { asyncApiSchemaVersion, loadAsyncApiSchema } from '../schemas'
import { isObject } from './helpers'

/**
 * Validates a whole AsyncAPI document against the official structural
 * meta-schema for the version it declares, parsing that version's schema on
 * first use. A document declaring a version this package bundles no schema for
 * (a future 2.7, say) reports nothing rather than being judged against a
 * neighbouring version's schema.
 *
 * The rule that calls this runs `resolved: false`, against the document as
 * written, which is what keeps one authored mistake to one finding. Validating
 * the dereferenced tree instead would re-check every `components` entry once per
 * `$ref` that reaches it, so a single bad reusable message reported three times
 * in a document that used it twice. The cost is that content pulled in from
 * another file is not structurally checked — the same trade-off the OpenAPI
 * preset's `oas*-schema` rules make.
 */
export const asyncApiDocumentSchema: RulesetFunction = (input, _options, context): IFunctionResult[] => {
  const version = asyncApiSchemaVersion(isObject(input) ? input['asyncapi'] : undefined)
  if (version === undefined) return []
  return schemaFunction(input, { schema: loadAsyncApiSchema(version), allErrors: true }, context) ?? []
}
