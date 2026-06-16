import { getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import {
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDefault,
  hasEnum,
  hasExamples,
  hasOneOf,
  hasPattern,
  hasProperties,
  hasRequired,
  hasType,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { generateDefaultFromPattern } from '#generators/generate-default-from-pattern'

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

  // A `const` value is the only valid value, so it is also the default.
  if (hasConst(schema)) {
    return JSON.stringify(schema.const)
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

  // x-mjst bigint has no native JSON type but a sensible zero default.
  if (getMjstPrimitive(schema) === 'bigint') {
    return '0n'
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
    case 'null':
      return 'null'
    case 'array':
      return '[]'
    case 'object': {
      // A bare `{}` omits required properties, leaving the default invalid against
      // its own type. Populate each required property with its own default so the
      // fallback object is itself a valid instance.
      if (hasProperties(schema) && hasRequired(schema)) {
        const props = schema.properties
        const parts = schema.required
          .filter((key) => Object.hasOwn(props, key))
          .map((key) => `${JSON.stringify(key)}: ${getDefaultValue(props[key] as JSONSchema)}`)
        if (parts.length > 0) return `{ ${parts.join(', ')} }`
      }
      return '{}'
    }
    default:
      return 'undefined'
  }
}
