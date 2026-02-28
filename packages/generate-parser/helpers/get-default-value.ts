import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { generateDefaultFromPattern } from '@/generators/generate-default-from-pattern'
import {
  hasAllOf,
  hasAnyOf,
  hasDefault,
  hasEnum,
  hasExamples,
  hasOneOf,
  hasPattern,
  hasType,
  isSchemaObject,
} from '@/type-guards/schema-guards'

/**
 * Returns the default value for a JSON Schema property.
 * Priority order: explicit default > first enum value > first example > union first schema > pattern-based > type-based.
 * These defaults ensure that parsing never fails, even with missing data.
 */
export const getDefaultValue = (schema: JSONSchema): string => {
  if (!isSchemaObject(schema)) {
    return 'undefined'
  }

  // Explicit default takes highest priority
  if (hasDefault(schema)) {
    return JSON.stringify(schema.default)
  }

  // Use first enum value if available
  if (hasEnum(schema) && schema.enum.length > 0) {
    return JSON.stringify(schema.enum[0])
  }

  // Use first example if available
  if (hasExamples(schema) && schema.examples.length > 0) {
    return JSON.stringify(schema.examples[0])
  }

  // Handle union types - use first schema's default
  if (hasOneOf(schema) && schema.oneOf.length > 0) {
    const firstSchema = schema.oneOf[0]
    if (firstSchema !== undefined) {
      return getDefaultValue(firstSchema)
    }
  }

  if (hasAnyOf(schema) && schema.anyOf.length > 0) {
    const firstSchema = schema.anyOf[0]
    if (firstSchema !== undefined) {
      return getDefaultValue(firstSchema)
    }
  }

  // Handle allOf - use first schema's default
  if (hasAllOf(schema) && schema.allOf.length > 0) {
    const firstSchema = schema.allOf[0]
    if (firstSchema !== undefined) {
      return getDefaultValue(firstSchema)
    }
  }

  if (!hasType(schema)) {
    return 'undefined'
  }

  switch (schema.type) {
    case 'string': {
      if (hasPattern(schema)) {
        const patternDefault = generateDefaultFromPattern(schema.pattern)
        if (patternDefault) {
          return patternDefault
        }
      }
      return '""'
    }
    case 'number':
    case 'integer':
      return '0'
    case 'boolean':
      return 'false'
    case 'array':
      return '[]'
    case 'object':
      return '{}'
    default:
      return 'undefined'
  }
}
