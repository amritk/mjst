import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { hasConst, hasEnum, hasProperties, isObjectSchema, isSchemaObject } from '@amritk/helpers/schema-guards'

/**
 * Gets the discriminator value for a specific schema.
 * Returns the const value or single enum value if available.
 */
export const getDiscriminatorValue = (schema: JSONSchema, discriminatorKey: string): unknown | null => {
  if (isObjectSchema(schema) && hasProperties(schema)) {
    const propSchema = schema.properties[discriminatorKey]
    if (propSchema && isSchemaObject(propSchema)) {
      if (hasConst(propSchema)) {
        return propSchema.const
      }
      if (hasEnum(propSchema) && propSchema.enum.length === 1) {
        return propSchema.enum[0]
      }
    }
  }
  return null
}
