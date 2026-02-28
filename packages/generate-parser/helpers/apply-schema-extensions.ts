import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import type { SchemaExtensions } from '#parser/types/schema-extensions'

/**
 * Merges custom extension properties into a schema's properties based on the
 * definition name. Extension properties are added as optional (not included
 * in the required array) since they are custom additions that may not always
 * be present.
 *
 * If the schema is not an object, has no matching extensions, or the
 * extensions record is empty, the original schema is returned unchanged.
 *
 * @param schema - The JSON Schema to extend
 * @param definitionName - The name of the definition (e.g., "parameter")
 * @param extensions - The extensions configuration mapping definition names to properties
 * @returns A new schema with extension properties merged in, or the original if unchanged
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: 'object',
 *   properties: { name: { type: 'string' } },
 *   required: ['name'],
 * }
 *
 * const extensions = {
 *   parameter: {
 *     'x-enabled': { type: 'boolean' },
 *   },
 * }
 *
 * const extended = applySchemaExtensions(schema, 'parameter', extensions)
 * // extended.properties now includes 'x-enabled' alongside 'name'
 * ```
 */
export const applySchemaExtensions = (
  schema: JSONSchema,
  definitionName: string,
  extensions: SchemaExtensions,
): JSONSchema => {
  const extensionProperties = extensions[definitionName]

  if (!extensionProperties || Object.keys(extensionProperties).length === 0) {
    return schema
  }

  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  const existingProperties =
    'properties' in schema && typeof schema.properties === 'object' && schema.properties !== null
      ? (schema.properties as Record<string, JSONSchema>)
      : {}

  return {
    ...schema,
    properties: {
      ...existingProperties,
      ...extensionProperties,
    },
  }
}
