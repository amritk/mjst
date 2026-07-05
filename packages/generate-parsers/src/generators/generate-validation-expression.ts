import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { multipleOfPassExpr } from '@amritk/helpers/multiple-of-check'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
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
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { findDiscriminator } from '#helpers/find-discriminator'
import { getDefaultValue } from '#helpers/get-default-value'

import { generateDiscriminatedUnionValidation } from './generate-discriminated-union-validation'
import { generateEnumCheck } from './generate-enum-check'
import { generateNonDiscriminatedUnionValidation } from './generate-non-discriminated-union-validation'
import { generateSchemaChecks } from './generate-schema-checks'

/**
 * Coercion expression for an `x-mjst` instanceOf value, when one is known.
 * `Date` can be reconstructed from the common JSON encodings (ISO string or
 * epoch number); other classes have no safe generic coercion, so we return null
 * and the caller falls back to the default.
 */
const getInstanceCoercion = (accessor: string, instanceOf: string): string | null => {
  if (instanceOf === 'Date') return `new Date(${accessor} as string | number | Date)`
  return null
}

/**
 * A boolean type check for an array element whose schema is a single scalar type
 * (the cases the element coercion below can handle). `integer` is treated as
 * `number` because the generated TS element type is `number`. Returns `null` for
 * objects, arrays, unions, `$ref`s, and anything richer.
 */
export const scalarItemTypeCheck = (itemSchema: JSONSchema, accessor: string): string | null => {
  if (!isSchemaObject(itemSchema) || !hasType(itemSchema) || hasEnum(itemSchema)) return null
  switch (itemSchema.type) {
    case 'string':
      return `typeof ${accessor} === "string"`
    case 'number':
      return `typeof ${accessor} === "number"`
    case 'integer':
      // `integer` items reject non-integral numbers; a bare typeof accepts `1.5`.
      return `typeof ${accessor} === "number" && Number.isInteger(${accessor})`
    case 'boolean':
      return `typeof ${accessor} === "boolean"`
    case 'null':
      return `${accessor} === null`
    default:
      return null
  }
}

/**
 * True when an array's `items` schema can be coerced element-by-element by the
 * mapping slow path: single scalar types (via {@link scalarItemTypeCheck}) and
 * enums (whose validation expression coerces a non-member to the first member).
 * Anything richer (objects, unions, `$ref`s) needs a real item parser instead.
 */
export const isCoercibleItemSchema = (itemSchema: JSONSchema): boolean => {
  if (scalarItemTypeCheck(itemSchema, '_it') !== null) return true
  return isSchemaObject(itemSchema) && hasEnum(itemSchema) && itemSchema.enum.length > 0
}

/**
 * A boolean type check for a single JSON Schema primitive type name. Unlike
 * {@link scalarItemTypeCheck} this also covers `array`/`object` (as inline shape
 * checks, so no `isObject` import is assumed) and enforces `integer` with
 * `Number.isInteger` — a bare `typeof === "number"` accepts `1.5`. Used to build
 * the disjunction for an array-form `type` (e.g. `["string","null"]`).
 */
const singleTypeCheck = (accessor: string, type: string): string | null => {
  switch (type) {
    case 'string':
      return `typeof ${accessor} === "string"`
    case 'number':
      return `typeof ${accessor} === "number"`
    case 'integer':
      return `typeof ${accessor} === "number" && Number.isInteger(${accessor})`
    case 'boolean':
      return `typeof ${accessor} === "boolean"`
    case 'null':
      return `${accessor} === null`
    case 'array':
      return `Array.isArray(${accessor})`
    case 'object':
      return `typeof ${accessor} === "object" && ${accessor} !== null && !Array.isArray(${accessor})`
    default:
      return null
  }
}

/**
 * Returns the list of type names when `schema.type` is an array (the JSON Schema
 * multi-type / nullable idiom, e.g. `["string","null"]`), or `null` for a single
 * or absent type. Multi-type is validated as a *disjunction* of per-type checks.
 */
const getTypeArray = (schema: JSONSchema): string[] | null => {
  if (!isSchemaObject(schema) || !('type' in schema) || !Array.isArray(schema.type)) return null
  return schema.type as string[]
}

/**
 * Generates a type coercion expression for converting a value to the expected type.
 */
const getTypeCoercion = (accessor: string, schema: JSONSchema, defaultValue: string): string | null => {
  if (!hasType(schema)) {
    return null
  }

  switch (schema.type) {
    case 'string':
      return `String(${accessor})`
    case 'number':
    case 'integer': {
      // Number() of a non-numeric string produces NaN, which silently poisons
      // arithmetic. Guard with Number.isFinite and fall back to the default.
      const n = `Number(${accessor})`
      return `(Number.isFinite(${n}) ? ${n} : ${defaultValue})`
    }
    case 'boolean':
      return `Boolean(${accessor})`
    case 'array':
      return `[]`
    case 'object':
      // Fall back to the schema's default (which fills required properties)
      // rather than a bare `{}`, so a coerced object is a valid instance.
      return `typeof ${accessor} === "object" && ${accessor} !== null ? ${accessor} : ${defaultValue}`
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

  // Handle x-mjst instanceOf (e.g. Date): the value must be an instance of the
  // named class. Invalid values are coerced when a coercer is known, otherwise
  // they fall back to the default (required) or undefined (optional).
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    const valid = `${accessor} instanceof ${instanceOf}`
    const coercion = getInstanceCoercion(accessor, instanceOf)

    if (isRequired) {
      return coercion
        ? `${valid} ? ${accessor} : (${accessor} !== undefined ? ${coercion} : ${defaultValue})`
        : `${valid} ? ${accessor} : ${defaultValue}`
    }
    return coercion
      ? `${valid} ? ${accessor} : (${accessor} !== undefined ? ${coercion} : undefined)`
      : `${valid} ? ${accessor} : undefined`
  }

  // Handle x-mjst primitive (e.g. bigint): validate with typeof. We do not
  // coerce — BigInt() throws on invalid input, which a pure coercion expression
  // cannot guard — so invalid values fall back to the default (required) or
  // undefined (optional).
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    const valid = `typeof ${accessor} === "${primitive}"`
    return isRequired ? `${valid} ? ${accessor} : ${defaultValue}` : `${valid} ? ${accessor} : undefined`
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

  // Array-form `type` (multi-type / nullable, e.g. `["string","null"]`). `hasType`
  // is false for an array `type`, so without this the value would fall through
  // every branch below and emit NO validation — not even a required-presence
  // check. Emit a disjunction: the value is accepted when it matches ANY listed
  // type, otherwise it is coerced to the default (required) or dropped (optional).
  // A missing value fails every disjunct, so `required` presence is still enforced.
  const typeArray = getTypeArray(schema)
  if (typeArray && !hasEnum(schema)) {
    const checks = typeArray.map((t) => singleTypeCheck(accessor, t)).filter((c): c is string => c !== null)
    if (checks.length > 0) {
      const combined = checks.map((c) => `(${c})`).join(' || ')
      return isRequired ? `${combined} ? ${accessor} : ${defaultValue}` : `${combined} ? ${accessor} : undefined`
    }
  }

  if (!hasType(schema) && !hasEnum(schema)) {
    return `${accessor} ?? ${defaultValue}`
  }

  // An array of scalar or enum items: coerce each element so e.g. `number[]`
  // actually contains numbers and an enum member set holds. The fast path only
  // takes a well-typed array, so a mistyped element reaches here. ($ref and
  // inline-object items use the caller's validateArray path; union items still
  // pass through.)
  if (
    hasType(schema) &&
    schema.type === 'array' &&
    hasItems(schema) &&
    !Array.isArray(schema.items) &&
    isCoercibleItemSchema(schema.items)
  ) {
    const itemSchema = schema.items
    const itemExpr = generateValidationExpression(
      '',
      itemSchema,
      getDefaultValue(itemSchema),
      true,
      rootSchema,
      visitedRefs,
      '_it',
      true,
    )
    const mapped = `(Array.isArray(${accessor}) ? (${accessor} as unknown[]).map((_it) => ${itemExpr}) : ${defaultValue})`
    return isRequired ? mapped : `(${accessor} !== undefined ? ${mapped} : undefined)`
  }

  // Build type-specific checks
  if (hasType(schema)) {
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
      case 'integer': {
        checks.push(`typeof ${accessor} === "number"`)
        // `integer` must reject non-integral numbers; a bare `typeof === "number"`
        // accepts `1.5`. Matches the validators package (which uses Number.isInteger).
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
      }
      case 'boolean':
        checks.push(`typeof ${accessor} === "boolean"`)
        break
      case 'null':
        checks.push(`${accessor} === null`)
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
  //
  // `enum` constrains the value to a fixed set, so type coercion (e.g.
  // `String(x)`) can't rescue a non-member — `String("z")` is still not in the
  // enum. Fall back to the default (the first enum value) so the result is always
  // a valid member of the declared literal-union type.
  const typeCoercion = hasEnum(schema) ? null : getTypeCoercion(accessor, schema, defaultValue)

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
