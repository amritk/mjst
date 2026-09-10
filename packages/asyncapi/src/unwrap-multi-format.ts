import { readKey } from '@amritk/helpers/read-key'

export type UnwrappedSchema = {
  /** The wrapper's `schemaFormat`, or `undefined` when the node was a bare schema. */
  readonly schemaFormat?: unknown
  readonly schema: unknown
}

/**
 * Unwraps an AsyncAPI 3.0 Multi Format Schema Object (`{ schemaFormat,
 * schema }`) into its parts, passing a bare Schema Object through untouched.
 *
 * An own `schema` key alone makes it a wrapper, which is exactly how the 3.0
 * meta-schema decides (`anySchema.json`: `if: { required: ['schema'] }` → the
 * Multi Format Schema Object, else a plain Schema Object). `schemaFormat` is
 * *optional* on the wrapper and defaults to the AsyncAPI dialect, so requiring
 * it here read `{ schema: … }` as a schema whose only keyword is one no dialect
 * defines — the payload vanished and the message generated an empty type.
 *
 * Note what this still does not claim: `{ schemaFormat: 'x', type: 'object' }`
 * has no `schema` key, so it stays a bare Schema Object that happens to carry
 * an unknown keyword, rather than a wrapper with nothing inside it. That is the
 * meta-schema's reading too, and it is why the check is on `schema` rather than
 * on either key being present.
 */
export const unwrapMultiFormat = (node: unknown): UnwrappedSchema => {
  if (typeof node === 'object' && node !== null && !Array.isArray(node) && Object.hasOwn(node, 'schema')) {
    const record = node as Record<string, unknown>
    return { schemaFormat: readKey(record, 'schemaFormat'), schema: readKey(record, 'schema') }
  }
  return { schema: node }
}
