import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { findDiscriminator } from '#helpers/find-discriminator'
import { resolveRef } from 'mjst-helpers/resolve-ref'
import { safeAccessor } from 'mjst-helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
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
  hasOneOf,
  hasPattern,
  hasProperties,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from 'mjst-helpers/schema-guards'
import { generateDiscriminatedUnionValidation } from './generate-discriminated-union-validation'
import { generateEnumCheck } from './generate-enum-check'
import { generateNonDiscriminatedUnionValidation } from './generate-non-discriminated-union-validation'
import { generateSchemaChecks } from './generate-schema-checks'

/**
 * Generates a type coercion expression for converting a value to the expected type.
 */
const getTypeCoercion = (accessor: string, schema: JSONSchema): string | null => {
  if (!hasType(schema)) {
    return null
  }

  switch (schema.type) {
    case 'string':
      return `String(${accessor})`
    case 'number':
    case 'integer':
      return `Number(${accessor})`
    case 'boolean':
      return `Boolean(${accessor})`
    case 'array':
      return `[]`
    case 'object':
      return `typeof ${accessor} === "object" && ${accessor} !== null ? ${accessor} : {}`
    default:
      return null
  }
}

/**
 * Generates a validation expression that checks if a value matches the expected type.
 * Returns the value if valid, coerces to the correct type if invalid, or uses default if required and missing.
 * Supports type checking, pattern validation, enum validation, union types, and $ref resolution.
 */
export const generateValidationExpression = (
  key: string,
  schema: JSONSchema,
  defaultValue: string,
  isRequired: boolean,
  rootSchema?: Record<string, unknown>,
  visitedRefs?: Set<string>,
  accessorOverride?: string,
  knownNotUndefined?: boolean,
): string => {
  const accessor = accessorOverride ?? safeAccessor('input?', key)
  const checks: string[] = []

  if (!isSchemaObject(schema)) {
    return isRequired ? `${accessor} ?? ${defaultValue}` : accessor
  }

  // Handle $ref - resolve and validate against the referenced schema
  if (hasRef(schema) && rootSchema) {
    const ref = schema.$ref

    // If we have already visited this ref, we have a circular reference - return accessor to break cycle
    if (visitedRefs?.has(ref)) {
      return isRequired ? `${accessor} ?? ${defaultValue}` : accessor
    }

    const resolvedSchema = resolveRef(ref, rootSchema)
    if (resolvedSchema) {
      const visited = new Set(visitedRefs)
      visited.add(ref)

      return generateValidationExpression(key, resolvedSchema, defaultValue, isRequired, rootSchema, visited)
    }
  }

  // Handle union types (oneOf, anyOf)
  if (hasOneOf(schema) && schema.oneOf.length > 0) {
    const discriminator = findDiscriminator(schema.oneOf)
    if (discriminator) {
      return generateDiscriminatedUnionValidation(accessor, schema.oneOf, discriminator, defaultValue, isRequired)
    }
    return generateNonDiscriminatedUnionValidation(accessor, schema.oneOf, defaultValue, isRequired)
  }

  if (hasAnyOf(schema) && schema.anyOf.length > 0) {
    const discriminator = findDiscriminator(schema.anyOf)
    if (discriminator) {
      return generateDiscriminatedUnionValidation(accessor, schema.anyOf, discriminator, defaultValue, isRequired)
    }
    return generateNonDiscriminatedUnionValidation(accessor, schema.anyOf, defaultValue, isRequired)
  }

  // Handle allOf (intersection - all schemas must match)
  if (hasAllOf(schema) && schema.allOf.length > 0) {
    const allChecks: string[] = []
    for (const subSchema of schema.allOf) {
      const subChecks = generateSchemaChecks(accessor, subSchema)
      allChecks.push(...subChecks)
    }

    if (allChecks.length > 0) {
      let combinedCheck = allChecks[0]
      for (let i = 1; i < allChecks.length; i++) {
        combinedCheck += ' && ' + allChecks[i]
      }
      return `${combinedCheck} ? ${accessor} : ${defaultValue}`
    }
    return `${accessor} ?? ${defaultValue}`
  }

  // Handle not (negation - value must NOT match this schema)
  if ('not' in schema && schema.not) {
    const notChecks = generateSchemaChecks(accessor, schema.not)
    if (notChecks.length > 0) {
      let combinedNotCheck = notChecks[0]
      for (let i = 1; i < notChecks.length; i++) {
        combinedNotCheck += ' && ' + notChecks[i]
      }
      return `!(${combinedNotCheck}) ? ${accessor} : ${defaultValue}`
    }
  }

  // Handle const — single exact value that must match
  if (hasConst(schema)) {
    const constLiteral = JSON.stringify(schema.const)
    return isRequired
      ? `${accessor} === ${constLiteral} ? ${accessor} : ${constLiteral}`
      : `${accessor} === ${constLiteral} ? ${accessor} : (${accessor} !== undefined ? ${constLiteral} : undefined)`
  }

  if (!hasType(schema) && !hasEnum(schema)) {
    return `${accessor} ?? ${defaultValue}`
  }

  // Build type-specific checks
  if (hasType(schema)) {
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
      case 'integer': {
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
      }
      case 'boolean':
        checks.push(`typeof ${accessor} === "boolean"`)
        break
      case 'array': {
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
      }
      case 'object': {
        checks.push(`isObject(${accessor})`)
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
  }

  // Add enum check if present
  if (hasEnum(schema) && schema.enum.length > 0) {
    checks.push(generateEnumCheck(accessor, schema.enum))
  }

  // Combine all checks
  if (checks.length === 0) {
    return isRequired ? `${accessor} ?? ${defaultValue}` : accessor
  }

  let combinedCheck = checks[0]
  for (let i = 1; i < checks.length; i++) {
    combinedCheck += ' && ' + checks[i]
  }

  // Generate the fallback value
  // If the value exists but fails validation, try to coerce it
  // If the value is missing and required, use the default
  const typeCoercion = getTypeCoercion(accessor, schema)

  if (isRequired) {
    // For required fields: valid ? use_value : (exists ? coerce : default)
    if (typeCoercion) {
      // If we know the value is not undefined (e.g., we're inside an undefined check),
      // we can skip the redundant undefined check
      if (knownNotUndefined) {
        return `${combinedCheck} ? ${accessor} : ${typeCoercion}`
      }
      return `${combinedCheck} ? ${accessor} : (${accessor} !== undefined ? ${typeCoercion} : ${defaultValue})`
    }
    return `${combinedCheck} ? ${accessor} : ${defaultValue}`
  } else {
    // For optional fields: valid ? use_value : (exists ? coerce : undefined)
    if (typeCoercion) {
      // If we know the value is not undefined, we can skip the check and just coerce
      if (knownNotUndefined) {
        return `${combinedCheck} ? ${accessor} : ${typeCoercion}`
      }
      return `${combinedCheck} ? ${accessor} : (${accessor} !== undefined ? ${typeCoercion} : undefined)`
    }
    return `${combinedCheck} ? ${accessor} : undefined`
  }
}
