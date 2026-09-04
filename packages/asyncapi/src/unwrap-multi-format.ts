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
 * The wrapper is recognized only when *both* keys are present: `schemaFormat`
 * is required on the wrapper, and demanding `schema` too keeps a plain schema
 * that merely declares a property named `schemaFormat` from losing its body.
 */
export const unwrapMultiFormat = (node: unknown): UnwrappedSchema => {
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    const record = node as Record<string, unknown>
    const schemaFormat = readKey(record, 'schemaFormat')
    if (schemaFormat !== undefined && Object.hasOwn(record, 'schema')) {
      return { schemaFormat, schema: readKey(record, 'schema') }
    }
  }
  return { schema: node }
}
