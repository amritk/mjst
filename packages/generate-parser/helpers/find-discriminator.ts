import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { hasConst, hasEnum, hasProperties, isObjectSchema, isSchemaObject } from '@/type-guards/schema-guards'

/**
 * Attempts to find a discriminator property that can be used to distinguish between union types.
 * Returns the property name if a suitable discriminator is found, otherwise null.
 */
export const findDiscriminator = (schemas: readonly JSONSchema[]): string | null => {
  // Look for a property that has different constant/enum values in each schema
  const propertyValues = new Map<string, Set<unknown>>()

  for (const schema of schemas) {
    if (isObjectSchema(schema) && hasProperties(schema)) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!propertyValues.has(key)) {
          propertyValues.set(key, new Set())
        }

        // Check if property has a const value
        if (isSchemaObject(propSchema) && hasConst(propSchema)) {
          propertyValues.get(key)?.add(propSchema.const)
        }
        // Check if property has a single enum value
        else if (isSchemaObject(propSchema) && hasEnum(propSchema) && propSchema.enum.length === 1) {
          propertyValues.get(key)?.add(propSchema.enum[0])
        }
      }
    }
  }

  // Find a property where each schema has a unique value
  for (const [key, values] of propertyValues.entries()) {
    if (values.size === schemas.length) {
      return key
    }
  }

  return null
}
