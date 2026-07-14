import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { multipleOfPassExpr } from '@amritk/helpers/multiple-of-check'
import {
  hasAdditionalProperties,
  hasConst,
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
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateEnumCheck } from './generate-enum-check'

/** The primitive JSON Schema types the inference below can resolve to. */
type InferredType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

// Keywords that only make sense on a given type. A branch that carries any of
// them but no explicit `type` is treated as that type for discrimination.
const OBJECT_KEYWORDS = [
  'properties',
  'required',
  'minProperties',
  'maxProperties',
  'additionalProperties',
  'patternProperties',
  'dependentRequired',
  'propertyNames',
] as const
const ARRAY_KEYWORDS = ['items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'contains'] as const
const STRING_KEYWORDS = ['minLength', 'maxLength', 'pattern', 'format'] as const
const NUMBER_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const

const countKeywords = (schema: object, keywords: readonly string[]): number =>
  keywords.reduce((total, keyword) => (keyword in schema ? total + 1 : total), 0)

/** Resolves the JSON Schema type of a single literal (a `const` value). */
const typeOfLiteral = (value: unknown): InferredType => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  if (type === 'boolean') return 'boolean'
  if (type === 'number' || type === 'bigint') return 'number'
  if (type === 'string') return 'string'
  return 'object'
}

/**
 * Infers the type of a schema branch that omits an explicit `type`.
 *
 * A `const` pins the value to one literal, so its type is definitive. An enum
 * of only `null`s can only be the null type. Otherwise each candidate type is
 * scored by how many of its characteristic keywords the schema carries and the
 * highest wins, with ties resolved in `object > array > string > number` order
 * (so `{ minProperties, minItems }` is an object and `{ minItems, maxItems,
 * minLength }` is an array). Returns undefined when nothing points at a type —
 * e.g. a bare `{ description }` — so the caller emits no checks.
 */
const inferSchemaType = (schema: JSONSchema): InferredType | undefined => {
  if (!isSchemaObject(schema)) return undefined

  if (hasConst(schema)) {
    return typeOfLiteral(schema.const)
  }

  if (hasEnum(schema) && schema.enum.length > 0 && schema.enum.every((value) => value === null)) {
    return 'null'
  }

  const scores = {
    object: countKeywords(schema, OBJECT_KEYWORDS),
    array: countKeywords(schema, ARRAY_KEYWORDS),
    string: countKeywords(schema, STRING_KEYWORDS),
    number: countKeywords(schema, NUMBER_KEYWORDS),
  }
  // Iterating in priority order and only replacing on a strictly-greater score
  // means the earliest (highest-priority) type wins any tie.
  let best: keyof typeof scores | undefined
  for (const type of ['object', 'array', 'string', 'number'] as const) {
    if (scores[type] > 0 && (best === undefined || scores[type] > scores[best])) {
      best = type
    }
  }
  return best
}

/**
 * Emits the checks for a branch whose type was inferred (not explicit). It
 * mirrors the explicit-type switch below, with two deliberate differences: the
 * enum membership check uses the `.includes` form (appended by the caller) and
 * `multipleOf` uses the plain `% === 0` form, matching the inference spec.
 */
const generateInferredChecks = (accessor: string, schema: JSONSchema, type: InferredType): string[] => {
  const checks: string[] = []

  switch (type) {
    case 'object':
      checks.push(`typeof ${accessor} === "object" && ${accessor} !== null && !Array.isArray(${accessor})`)
      if (hasRequired(schema) && schema.required.length > 0) {
        for (const requiredKey of schema.required) {
          checks.push(`${JSON.stringify(requiredKey)} in ${accessor}`)
        }
      }
      if (hasMinProperties(schema)) {
        checks.push(`Object.keys(${accessor}).length >= ${schema.minProperties}`)
      }
      if (hasMaxProperties(schema)) {
        checks.push(`Object.keys(${accessor}).length <= ${schema.maxProperties}`)
      }
      if (hasAdditionalProperties(schema) && schema.additionalProperties === false && hasProperties(schema)) {
        const allowedKeysStr = JSON.stringify(Object.keys(schema.properties))
        checks.push(`Object.keys(${accessor}).every(k => ${allowedKeysStr}.includes(k))`)
      }
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
    case 'string':
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
    case 'number':
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
    case 'null':
      // A `null` inferred from an all-null enum is covered by the membership
      // check the caller appends; only a `const: null` needs its own identity
      // check here.
      if (hasConst(schema)) {
        checks.push(`${accessor} === null`)
      }
      break
  }

  return checks
}

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

  // Without an explicit `type`, a branch's keywords still imply one. Inferring
  // it lets union discrimination reject the branch instead of matching anything.
  if (!hasType(schema)) {
    const inferred = inferSchemaType(schema)
    if (!inferred) {
      return checks
    }
    checks.push(...generateInferredChecks(accessor, schema, inferred))
    if (hasEnum(schema) && schema.enum.length > 0) {
      checks.push(`${JSON.stringify(schema.enum)}.includes(${accessor} as never)`)
    }
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
      // `integer` must reject non-integral numbers (a bare typeof accepts `1.5`).
      if (schema.type === 'integer') {
        checks.push(`Number.isInteger(${accessor})`)
      }
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
        checks.push(multipleOfPassExpr(accessor, schema.multipleOf))
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
