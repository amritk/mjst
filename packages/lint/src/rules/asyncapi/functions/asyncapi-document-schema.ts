import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { asyncApiSchemaVersion, loadAsyncApiSchema, loadResolvedAsyncApiSchema } from '../schemas'
import { isObject } from './helpers'

/** Options for {@link asyncApiDocumentSchema}. */
export type IAsyncApiDocumentSchemaOptions = {
  /**
   * Whether this rule is the one running against the `$ref`-dereferenced tree.
   * Both passes validate against the same published meta-schema — what differs
   * is the tree they see, so the resolved pass is what actually inspects the
   * content behind a `$ref`.
   */
  resolved?: boolean
}

/**
 * Validates a whole AsyncAPI document against the official structural
 * meta-schema for the version it declares, parsing that version's schema on
 * first use. A document declaring a version this package bundles no schema for
 * (a future 2.7, say) reports nothing rather than being judged against a
 * neighbouring version's schema.
 *
 * The meta-schemas model a `$ref` as a valid alternative nearly everywhere, so
 * the unresolved pass accepts any reference without looking at its target. The
 * `resolved: true` twin is what validates the inlined content — but only when a
 * `$ref` resolver was actually injected: with none, the engine falls back to
 * handing resolved rules the raw tree, which is the same tree (and the same
 * findings) the unresolved rule already covered. Recognising that by identity
 * keeps the pair from reporting every structural error twice.
 */
export const asyncApiDocumentSchema: RulesetFunction<unknown, IAsyncApiDocumentSchemaOptions> = (
  input,
  options,
  context,
): IFunctionResult[] => {
  const resolved = options?.resolved === true
  if (resolved && input === context.document.data) return []
  const version = asyncApiSchemaVersion(isObject(input) ? input['asyncapi'] : undefined)
  if (version === undefined) return []
  const schema = resolved ? loadResolvedAsyncApiSchema(version) : loadAsyncApiSchema(version)
  return schemaFunction(input, { schema, allErrors: true }, context) ?? []
}
