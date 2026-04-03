/**
 * Upgrades a JSON Schema draft-07 document to be compatible with the
 * draft 2020-12 conventions used by the build pipeline.
 *
 * Draft-07 schemas differ from 2020-12 in two ways that affect our pipeline:
 * - They use `definitions` instead of `$defs`
 * - Their `definitions` keys (and `$ref` values) may be full URIs
 *   (e.g. `http://asyncapi.com/definitions/3.1.0/channel.json`) rather than
 *   short names (e.g. `channel`)
 *
 * This function performs a single recursive pass that renames every
 * `definitions` key to `$defs` throughout the entire schema tree, leaving
 * all keys and `$ref` values untouched. After this pass:
 * - `resolveRef` can look up URI keys directly in `$defs`
 * - `extractRefs` yields URI refs so the build loop queues them
 * - `refToFilename` / `refToName` derive names from the URI's last path segment
 *
 * Only applied when the schema declares `$schema: http://json-schema.org/draft-07/schema`.
 */

/**
 * Returns true if the schema is a draft-07 document that needs upgrading.
 * Detects draft-07 by the `$schema` declaration.
 */
export const isDraft07Schema = (schema: Record<string, unknown>): boolean =>
  typeof schema['$schema'] === 'string' &&
  schema['$schema'].includes('draft-07')

/**
 * Recursively renames every `definitions` key to `$defs` in the schema tree.
 * Keys and values (including `$ref` strings) are left unchanged — only the
 * container key name is renamed.
 */
const renameDefs = (obj: unknown): unknown => {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(renameDefs)

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    const outKey = key === 'definitions' ? '$defs' : key
    result[outKey] = renameDefs(value)
  }

  return result
}

/**
 * Upgrades a draft-07 schema so it is compatible with the build pipeline.
 * If the schema is not draft-07, it is returned unchanged.
 *
 * @param schema - The raw JSON Schema (any draft)
 * @returns The schema with `definitions` renamed to `$defs` throughout
 */
export const upgradeDraft07Schema = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (!isDraft07Schema(schema)) return schema
  return renameDefs(schema) as Record<string, unknown>
}
