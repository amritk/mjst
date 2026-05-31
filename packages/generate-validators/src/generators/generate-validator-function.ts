import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToName } from '@amritk/helpers/ref-to-name'
import {
  hasAdditionalProperties,
  hasConst,
  hasDependentRequired,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
  hasMaximum,
  hasMaxLength,
  hasMinimum,
  hasMinLength,
  hasMultipleOf,
  hasOneOf,
  hasPattern,
  hasProperties,
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasType,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Derives the validator function name from a type name.
 * e.g. "InfoObject" → "validateInfoObject"
 */
const validatorName = (typeName: string): string => `validate${typeName}`

/**
 * Returns the TypeScript typeof string for a JSON Schema primitive type.
 */
const typeofString = (type: string): string => {
  if (type === 'integer') return 'number'
  return type
}

/**
 * Generates the inline condition that is TRUE when `accessor` does NOT equal the
 * `const` value. Primitives compare with `!==`; objects/arrays compare by their
 * canonical JSON serialization (sufficient for the literal, fixed shapes `const`
 * is used for).
 */
const constMismatchCondition = (accessor: string, value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return `${accessor} !== ${JSON.stringify(value)}`
  }
  return `JSON.stringify(${accessor}) !== ${JSON.stringify(JSON.stringify(value))}`
}

/**
 * Generates the inline condition that is TRUE when a value is the wrong type.
 */
const wrongTypeCondition = (accessor: string, type: string): string => {
  switch (type) {
    case 'string':
      return `typeof ${accessor} !== 'string'`
    case 'number':
    case 'integer':
      return `typeof ${accessor} !== 'number'`
    case 'boolean':
      return `typeof ${accessor} !== 'boolean'`
    case 'array':
      return `!Array.isArray(${accessor})`
    case 'object':
      return `typeof ${accessor} !== 'object' || ${accessor} === null || Array.isArray(${accessor})`
    default:
      return ''
  }
}

/**
 * Generates validation lines for a single property in an object schema.
 * Handles $ref delegation, enum checks, type checks, and string/number constraints.
 */
const generatePropertyChecks = (key: string, propSchema: JSONSchema, isRequired: boolean, suffix: string): string[] => {
  if (!isSchemaObject(propSchema)) return []

  const raw = `obj[${JSON.stringify(key)}]`
  const path = `\`\${_path}/${key}\``
  const lines: string[] = []

  // $ref — delegate to the imported validator
  if (hasRef(propSchema)) {
    const ref = propSchema.$ref
    const vName = validatorName(refToName(ref, suffix))

    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in obj)) {`)
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: _path })`)
      lines.push(`  } else {`)
      lines.push(`    const _r = ${vName}(${raw}, ${path})`)
      lines.push(`    if (_r !== true) errors.push(..._r.errors)`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined) {`)
      lines.push(`    const _r = ${vName}(${raw}, ${path})`)
      lines.push(`    if (_r !== true) errors.push(..._r.errors)`)
      lines.push(`  }`)
    }
    return lines
  }

  // x-mjst instanceOf (e.g. Date) — value must be an instance of the class
  const instanceOf = getMjstInstanceOf(propSchema)
  if (instanceOf) {
    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in obj)) {`)
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: _path })`)
      lines.push(`  } else if (!(${raw} instanceof ${instanceOf})) {`)
      lines.push(`    errors.push({ message: 'must be ${instanceOf}', path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && !(${raw} instanceof ${instanceOf})) {`)
      lines.push(`    errors.push({ message: 'must be ${instanceOf}', path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // x-mjst primitive (e.g. bigint) — value must satisfy a typeof check
  const primitive = getMjstPrimitive(propSchema)
  if (primitive) {
    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in obj)) {`)
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: _path })`)
      lines.push(`  } else if (typeof ${raw} !== "${primitive}") {`)
      lines.push(`    errors.push({ message: 'must be ${primitive}', path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && typeof ${raw} !== "${primitive}") {`)
      lines.push(`    errors.push({ message: 'must be ${primitive}', path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // const — value must equal the fixed value exactly
  if (hasConst(propSchema)) {
    const mismatch = constMismatchCondition(raw, propSchema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(propSchema.const)}`)
    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in obj)) {`)
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: _path })`)
      lines.push(`  } else if (${mismatch}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && ${mismatch}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // enum
  if (hasEnum(propSchema)) {
    const allowed = JSON.stringify(propSchema.enum)
    const label = (propSchema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')

    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in obj)) {`)
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: _path })`)
      lines.push(`  } else if (!(${allowed} as unknown[]).includes(${raw})) {`)
      lines.push(`    errors.push({ message: \`must be one of: ${label}\`, path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && !(${allowed} as unknown[]).includes(${raw})) {`)
      lines.push(`    errors.push({ message: \`must be one of: ${label}\`, path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // typed property
  if (hasType(propSchema)) {
    const t = propSchema.type as string
    const wrongType = wrongTypeCondition(raw, t)
    const typLabel = typeofString(t)

    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in obj)) {`)
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: _path })`)
      if (wrongType) {
        lines.push(`  } else if (${wrongType}) {`)
        lines.push(`    errors.push({ message: 'must be ${typLabel}', path: ${path} })`)
      }
      lines.push(`  }`)
    } else if (wrongType) {
      lines.push(`  if (${raw} !== undefined && (${wrongType})) {`)
      lines.push(`    errors.push({ message: 'must be ${typLabel}', path: ${path} })`)
      lines.push(`  }`)
    }

    // String constraints
    if (t === 'string') {
      if (hasPattern(propSchema)) {
        const re = escapeRegexPattern(propSchema.pattern)
        const msg = JSON.stringify(`must match pattern ${propSchema.pattern}`)
        lines.push(`  if (typeof ${raw} === 'string' && !/${re}/.test(${raw})) {`)
        lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
        lines.push(`  }`)
      }
      if (hasMinLength(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'string' && ${raw}.length < ${propSchema.minLength}) {`)
        lines.push(
          `    errors.push({ message: 'must have at least ${propSchema.minLength} characters', path: ${path} })`,
        )
        lines.push(`  }`)
      }
      if (hasMaxLength(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'string' && ${raw}.length > ${propSchema.maxLength}) {`)
        lines.push(
          `    errors.push({ message: 'must have at most ${propSchema.maxLength} characters', path: ${path} })`,
        )
        lines.push(`  }`)
      }
    }

    // Number constraints
    if (t === 'number' || t === 'integer') {
      if (hasMinimum(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'number' && ${raw} < ${propSchema.minimum}) {`)
        lines.push(`    errors.push({ message: 'must be >= ${propSchema.minimum}', path: ${path} })`)
        lines.push(`  }`)
      }
      if (hasMaximum(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'number' && ${raw} > ${propSchema.maximum}) {`)
        lines.push(`    errors.push({ message: 'must be <= ${propSchema.maximum}', path: ${path} })`)
        lines.push(`  }`)
      }
      if (hasExclusiveMinimum(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'number' && ${raw} <= ${propSchema.exclusiveMinimum}) {`)
        lines.push(`    errors.push({ message: 'must be > ${propSchema.exclusiveMinimum}', path: ${path} })`)
        lines.push(`  }`)
      }
      if (hasExclusiveMaximum(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'number' && ${raw} >= ${propSchema.exclusiveMaximum}) {`)
        lines.push(`    errors.push({ message: 'must be < ${propSchema.exclusiveMaximum}', path: ${path} })`)
        lines.push(`  }`)
      }
      if (hasMultipleOf(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'number' && ${raw} % ${propSchema.multipleOf} !== 0) {`)
        lines.push(`    errors.push({ message: 'must be a multiple of ${propSchema.multipleOf}', path: ${path} })`)
        lines.push(`  }`)
      }
    }

    // Array with typed items
    if (t === 'array' && hasItems(propSchema)) {
      const itemSchema = propSchema.items
      if (hasRef(itemSchema)) {
        const vName = validatorName(refToName(itemSchema.$ref, suffix))
        lines.push(`  if (Array.isArray(${raw})) {`)
        lines.push(`    for (let _i = 0; _i < ${raw}.length; _i++) {`)
        lines.push(`      const _ir = ${vName}(${raw}[_i], \`${path.slice(1, -1)}/${key}/\${_i}\`)`)
        lines.push(`      if (_ir !== true) errors.push(..._ir.errors)`)
        lines.push(`    }`)
        lines.push(`  }`)
      } else if (hasType(itemSchema)) {
        const itemType = itemSchema.type as string
        const itemWrong = wrongTypeCondition('_item', itemType)
        const itemLabel = typeofString(itemType)
        if (itemWrong) {
          lines.push(`  if (Array.isArray(${raw})) {`)
          lines.push(`    for (let _i = 0; _i < ${raw}.length; _i++) {`)
          lines.push(`      const _item = ${raw}[_i]`)
          lines.push(
            `      if (${itemWrong}) errors.push({ message: 'items must be ${itemLabel}', path: \`${path.slice(1, -1)}/${key}/\${_i}\` })`,
          )
          lines.push(`    }`)
          lines.push(`  }`)
        }
      }
    }
  }

  return lines
}

/**
 * Generates a validator function body for an object schema, checking each
 * property's presence and type and collecting all errors.
 */
const generateObjectValidator = (schema: JSONSchema, typeName: string, suffix: string): string => {
  const vName = validatorName(typeName)
  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}

  const propertyLines: string[] = []

  for (const [key, propSchema] of Object.entries(properties)) {
    const checks = generatePropertyChecks(key, propSchema as JSONSchema, required.has(key), suffix)
    if (checks.length > 0) {
      propertyLines.push(...checks)
    }
  }

  // additionalProperties with a $ref schema validates all extra keys
  if (
    hasAdditionalProperties(schema) &&
    isSchemaObject(schema.additionalProperties) &&
    hasRef(schema.additionalProperties)
  ) {
    const vRefName = validatorName(refToName(schema.additionalProperties.$ref, suffix))
    propertyLines.push(`  for (const _key of Object.keys(obj)) {`)
    propertyLines.push(`    if (${JSON.stringify(Object.keys(properties))}.includes(_key)) continue`)
    propertyLines.push(`    const _r = ${vRefName}(obj[_key as keyof typeof obj], \`\${_path}/\${_key}\`)`)
    propertyLines.push(`    if (_r !== true) errors.push(..._r.errors)`)
    propertyLines.push(`  }`)
  }

  // dependentRequired — when a trigger property is present, its dependencies must be too.
  if (hasDependentRequired(schema)) {
    for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
      if (!Array.isArray(deps)) continue
      for (const dep of deps) {
        const msg = JSON.stringify(`must have property '${dep}' when '${trigger}' is present`)
        propertyLines.push(`  if (${JSON.stringify(trigger)} in obj && !(${JSON.stringify(dep)} in obj)) {`)
        propertyLines.push(`    errors.push({ message: ${msg}, path: _path })`)
        propertyLines.push(`  }`)
      }
    }
  }

  // propertyNames with a pattern — every key must match. (Only the pattern form
  // is emitted; a $ref/complex propertyNames schema is left to runtime validation.)
  if (hasPropertyNames(schema) && isSchemaObject(schema.propertyNames) && hasPattern(schema.propertyNames)) {
    const re = escapeRegexPattern(schema.propertyNames.pattern)
    const msg = JSON.stringify(`property name must match pattern ${schema.propertyNames.pattern}`)
    propertyLines.push(`  for (const _name of Object.keys(obj)) {`)
    propertyLines.push(`    if (!/${re}/.test(_name)) {`)
    propertyLines.push(`      errors.push({ message: ${msg}, path: \`\${_path}/\${_name}\` })`)
    propertyLines.push(`    }`)
    propertyLines.push(`  }`)
  }

  const body = propertyLines.length > 0 ? '\n' + propertyLines.join('\n') + '\n' : ''

  return [
    `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
    `  if (typeof input !== 'object' || input === null || Array.isArray(input)) {`,
    `    return { valid: false, errors: [{ message: 'must be object', path: _path }] }`,
    `  }`,
    ``,
    `  const errors: ValidationError[] = []`,
    `  const obj = input as Record<string, unknown>`,
    body,
    `  return errors.length > 0 ? { valid: false, errors } : true`,
    `}`,
  ].join('\n')
}

/**
 * Generates a validator function for a non-object schema (primitive, array, enum, $ref).
 */
const generateScalarValidator = (schema: JSONSchema, typeName: string, suffix: string): string => {
  const vName = validatorName(typeName)

  if (!isSchemaObject(schema)) {
    return [`export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`, `  return true`, `}`].join(
      '\n',
    )
  }

  // Top-level $ref — delegate entirely
  if (hasRef(schema)) {
    const delegateName = validatorName(refToName(schema.$ref, suffix))
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  return ${delegateName}(input, _path)`,
      `}`,
    ].join('\n')
  }

  // Top-level x-mjst instanceOf (e.g. a schema that is itself a Date)
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (!(input instanceof ${instanceOf})) {`,
      `    return { valid: false, errors: [{ message: 'must be ${instanceOf}', path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level x-mjst primitive (e.g. a schema that is itself a bigint)
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (typeof input !== "${primitive}") {`,
      `    return { valid: false, errors: [{ message: 'must be ${primitive}', path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level const
  if (hasConst(schema)) {
    const mismatch = constMismatchCondition('input', schema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(schema.const)}`)
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (${mismatch}) {`,
      `    return { valid: false, errors: [{ message: ${msg}, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level enum
  if (hasEnum(schema)) {
    const allowed = JSON.stringify(schema.enum)
    const label = (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (!(${allowed} as unknown[]).includes(input)) {`,
      `    return { valid: false, errors: [{ message: \`must be one of: ${label}\`, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // oneOf — try each branch, return errors from all if none match
  if (hasOneOf(schema)) {
    const branches = schema.oneOf
      .map((branch, i) => {
        if (!hasRef(branch)) return null
        const bName = validatorName(refToName((branch as { $ref: string }).$ref, suffix))
        return `  const _r${i} = ${bName}(input, _path)\n  if (_r${i} === true) return true`
      })
      .filter(Boolean)
      .join('\n')

    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      branches,
      `  return { valid: false, errors: [{ message: 'must match one of the expected schemas', path: _path }] }`,
      `}`,
    ].join('\n')
  }

  // Top-level typed schema (string, number, boolean, array)
  if (hasType(schema)) {
    const t = schema.type as string
    const wrongType = wrongTypeCondition('input', t)
    const typLabel = typeofString(t)

    const constraintLines: string[] = []

    if (t === 'string') {
      if (hasPattern(schema)) {
        const re = escapeRegexPattern(schema.pattern)
        const msg = JSON.stringify(`must match pattern ${schema.pattern}`)
        constraintLines.push(`  if (typeof input === 'string' && !/${re}/.test(input)) {`)
        constraintLines.push(`    errors.push({ message: ${msg}, path: _path })`)
        constraintLines.push(`  }`)
      }
      if (hasMinLength(schema)) {
        constraintLines.push(`  if (typeof input === 'string' && input.length < ${schema.minLength}) {`)
        constraintLines.push(
          `    errors.push({ message: 'must have at least ${schema.minLength} characters', path: _path })`,
        )
        constraintLines.push(`  }`)
      }
      if (hasMaxLength(schema)) {
        constraintLines.push(`  if (typeof input === 'string' && input.length > ${schema.maxLength}) {`)
        constraintLines.push(
          `    errors.push({ message: 'must have at most ${schema.maxLength} characters', path: _path })`,
        )
        constraintLines.push(`  }`)
      }
    }

    if (!wrongType) {
      return [
        `export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    if (constraintLines.length === 0) {
      return [
        `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
        `  if (${wrongType}) {`,
        `    return { valid: false, errors: [{ message: 'must be ${typLabel}', path: _path }] }`,
        `  }`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (${wrongType}) {`,
      `    return { valid: false, errors: [{ message: 'must be ${typLabel}', path: _path }] }`,
      `  }`,
      `  const errors: ValidationError[] = []`,
      constraintLines.join('\n'),
      `  return errors.length > 0 ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')
  }

  return [`export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`, `  return true`, `}`].join(
    '\n',
  )
}

/**
 * Generates a TypeScript validator function from a JSON Schema.
 *
 * The generated function accepts `unknown` input and returns `true` if valid,
 * or `{ valid: false, errors }` with a list of errors if not.
 *
 * Object schemas check that required properties are present and that all
 * provided properties match their declared types. Non-object schemas (strings,
 * numbers, enums, $refs) emit an inline type check.
 *
 * @example
 * ```typescript
 * generateValidatorFunction({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, 'Info')
 * // export const validateInfo = (input: unknown, _path = ''): ValidationResult => {
 * //   if (typeof input !== 'object' || ...) return { valid: false, ... }
 * //   const errors: ValidationError[] = []
 * //   const obj = input as Record<string, unknown>
 * //   if (!('name' in obj)) { errors.push(...) } else if (typeof obj['name'] !== 'string') { errors.push(...) }
 * //   return errors.length > 0 ? { valid: false, errors } : true
 * // }
 * ```
 */
export const generateValidatorFunction = (schema: JSONSchema, typeName: string, suffix = ''): string => {
  if (isObjectSchema(schema)) {
    return generateObjectValidator(schema, typeName, suffix)
  }

  return generateScalarValidator(schema, typeName, suffix)
}
