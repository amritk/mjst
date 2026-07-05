import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
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
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateEnumCheck } from './generate-enum-check'

/**
 * Generates validation checks for a single schema (used in union validation).
 */
export const generateSchemaChecks = (accessor: string, schema: JSONSchema): string[] => {
  const checks: string[] = []

  // x-mjst instanceOf nodes validate purely by instance check (no native type).
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return [`${accessor} instanceof ${instanceOf}`]
  }

  // x-mjst primitive nodes (e.g. bigint) validate purely by typeof check.
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return [`typeof ${accessor} === "${primitive}"`]
  }

  if (!hasType(schema)) {
    return checks
  }

  switch (schema.type) {
    case 'string': {
      checks.push(`typeof ${accessor} === "string"`)
      if (hasPattern(schema)) {
        checks.push(`/${escapeRegexPattern(schema.pattern)}/.test(${accessor})`)
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
          checks.push(`${JSON.stringify(requiredKey)} in ${accessor}`)
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
