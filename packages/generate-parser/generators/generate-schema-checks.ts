import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import {
  hasAdditionalProperties,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMaxProperties,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMinProperties,
  hasMultipleOf,
  hasPattern,
  hasProperties,
  hasRequired,
  hasType,
  hasUniqueItems,
} from '#parser/type-guards/schema-guards'
import { generateEnumCheck } from './generate-enum-check'

/**
 * Generates validation checks for a single schema (used in union validation).
 */
export const generateSchemaChecks = (accessor: string, schema: JSONSchema): string[] => {
  const checks: string[] = []

  if (!hasType(schema)) {
    return checks
  }

  switch (schema.type) {
    case 'string': {
      checks.push(`typeof ${accessor} === "string"`)
      if (hasPattern(schema)) {
        checks.push(`/${schema.pattern}/.test(${accessor})`)
      }
      if (hasMinLength(schema)) {
        checks.push(`${accessor}.length >= ${schema.minLength}`)
      }
      if (hasMaxLength(schema)) {
        checks.push(`${accessor}.length <= ${schema.maxLength}`)
      }
      break
    }
    case 'number':
    case 'integer':
      checks.push(`typeof ${accessor} === "number"`)
      if (hasMinimum(schema)) {
        checks.push(`${accessor} >= ${schema.minimum}`)
      }
      if (hasMaximum(schema)) {
        checks.push(`${accessor} <= ${schema.maximum}`)
      }
      if (hasExclusiveMinimum(schema)) {
        checks.push(`${accessor} > ${schema.exclusiveMinimum}`)
      }
      if (hasExclusiveMaximum(schema)) {
        checks.push(`${accessor} < ${schema.exclusiveMaximum}`)
      }
      if (hasMultipleOf(schema)) {
        checks.push(`${accessor} % ${schema.multipleOf} === 0`)
      }
      break
    case 'boolean':
      checks.push(`typeof ${accessor} === "boolean"`)
      break
    case 'array':
      checks.push(`Array.isArray(${accessor})`)
      if (hasMinItems(schema)) {
        checks.push(`${accessor}.length >= ${schema.minItems}`)
      }
      if (hasMaxItems(schema)) {
        checks.push(`${accessor}.length <= ${schema.maxItems}`)
      }
      if (hasUniqueItems(schema) && schema.uniqueItems === true) {
        checks.push(`new Set(${accessor}).size === ${accessor}.length`)
      }
      break
    case 'object': {
      checks.push(`typeof ${accessor} === "object" && ${accessor} !== null && !Array.isArray(${accessor})`)
      // Check required properties exist
      if (hasRequired(schema) && schema.required.length > 0) {
        for (const requiredKey of schema.required) {
          checks.push(`"${requiredKey}" in ${accessor}`)
        }
      }
      // Check minProperties
      if (hasMinProperties(schema)) {
        checks.push(`Object.keys(${accessor}).length >= ${schema.minProperties}`)
      }
      // Check maxProperties
      if (hasMaxProperties(schema)) {
        checks.push(`Object.keys(${accessor}).length <= ${schema.maxProperties}`)
      }
      // Check additionalProperties
      if (hasAdditionalProperties(schema) && schema.additionalProperties === false && hasProperties(schema)) {
        const allowedKeys = Object.keys(schema.properties)
        const allowedKeysStr = JSON.stringify(allowedKeys)
        checks.push(`Object.keys(${accessor}).every(k => ${allowedKeysStr}.includes(k))`)
      }
      break
    }
  }

  if (hasEnum(schema) && schema.enum.length > 0) {
    checks.push(generateEnumCheck(accessor, schema.enum))
  }

  return checks
}
