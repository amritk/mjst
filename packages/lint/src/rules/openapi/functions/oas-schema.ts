import type { RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { loadOasSchema, type OasVersion } from '../schemas'

/** Options for {@link oasSchema}: which OpenAPI version's meta-schema to validate against. */
export type IOasSchemaOptions = {
  version: OasVersion
}

/**
 * Validates a whole OpenAPI document against the official structural meta-schema
 * for a given `version`, parsing that version's schema on first use. The
 * `*-schema` rules are format-gated to a single version, so linting a document
 * only ever parses its own version's schema — the other versions stay as
 * unparsed text. Delegates the actual validation to the built-in `schema`
 * function (which caches the prepared validator by schema identity).
 */
export const oasSchema: RulesetFunction<unknown, IOasSchemaOptions> = (input, options, context) => {
  if (!options?.version) return []
  return schemaFunction(input, { schema: loadOasSchema(options.version) }, context)
}
