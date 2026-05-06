import { refToName } from '@amritk/helpers/ref-to-name'
import { safeAccessor, safeKey } from '@amritk/helpers/safe-accessor'
import {
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDefault,
  hasEnum,
  hasExamples,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMultipleOf,
  hasOneOf,
  hasPattern,
  hasProperties,
  hasRef,
  hasType,
  hasUniqueItems,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { getDefaultValue } from '#helpers/get-default-value'

import { generateValidationExpression } from './generate-validation-expression'

/**
 * Options for controlling parser function generation behavior.
 */
type GenerateParserOptions = {
  /**
   * When true, properties with $ref will call the imported parser function
   * instead of inlining the validation logic. This is used when generating
   * files where each ref has its own separate file with a parser.
   */
  readonly useRefImports?: boolean
  /**
   * When true, the generated parser emits a console.warn for every input key
   * that is not declared in the schema's properties.
   */
  readonly logUnmatched?: boolean
}

/**
 * Represents a property in the generated object literal.
 */
type PropertyEntry = {
  readonly key: string
  readonly value: string
  readonly isOptional: boolean
}

/**
 * Generates the parser function name from a type name.
 * Converts "UserObject" to "parseUserObject".
 */
const generateParserName = (typeName: string): string => {
  return `parse${typeName}`
}

/**
 * Checks if a property is required based on the schema's required array.
 */
const isPropertyRequired = (key: string, schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) {
    return false
  }
  if (!('required' in schema) || !Array.isArray(schema.required)) {
    return false
  }
  return schema.required.includes(key)
}

/**
 * Generates a parser call expression for a required $ref property.
 * Example: parseContactObject(input.contact)
 */
const generateRequiredRefCall = (key: string, ref: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref))
  return `${parserName}(${acc})`
}

/**
 * Generates a parser call expression for an optional $ref property.
 * Example: ...(input.contact && { contact: parseContactObject(input.contact) })
 */
const generateOptionalRefCall = (key: string, ref: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref))
  return `...(${acc} && { ${safeKey(key)}: ${parserName}(${acc}) })`
}

/**
 * Generates a validateArray call for required array properties with $ref items.
 * Example: validateArray(input.contacts, parseContactObject)
 */
const generateRequiredArrayRefCall = (key: string, ref: string): string => {
  const parserName = generateParserName(refToName(ref))
  return `validateArray(${safeAccessor('input', key)}, ${parserName})`
}

/**
 * Generates a validateArray call for optional array properties with $ref items.
 * Example: ...(input.contacts && { contacts: validateArray(input.contacts, parseContactObject) })
 */
const generateOptionalArrayRefCall = (key: string, ref: string): string => {
  const parserName = generateParserName(refToName(ref))
  const acc = safeAccessor('input', key)
  return `...(${acc} && { ${safeKey(key)}: validateArray(${acc}, ${parserName}) })`
}

/**
 * Generates a validateRecord call for required object properties with additionalProperties $ref.
 * Example: validateRecord(input.responses, parseResponseObject)
 */
const generateRequiredRecordRefCall = (key: string, ref: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref))
  return `validateRecord(${acc}, ${parserName})`
}

/**
 * Generates a validateRecord call for optional object properties with additionalProperties $ref.
 * Example: ...(input.responses && { responses: validateRecord(input.responses, parseResponseObject) })
 */
const generateOptionalRecordRefCall = (key: string, ref: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref))
  return `...(${acc} && { ${safeKey(key)}: validateRecord(${acc}, ${parserName}) })`
}

/**
 * Generates a spread entry for optional inline properties.
 * The value expression is evaluated once and omitted when undefined.
 */
const generateOptionalInlineProperty = (key: string, valueExpression: string): string => {
  return `...((value => value === undefined ? {} : { ${safeKey(key)}: value })(${valueExpression}))`
}

/**
 * Determines if a property schema should use ref imports for validation.
 */
const shouldUseRefImport = (propSchema: JSONSchema, useRefImports: boolean): boolean => {
  if (!useRefImports || !hasRef(propSchema)) {
    return false
  }

  const ref = (propSchema as { $ref: string }).$ref
  // Skip external URI refs with property/definition fragments — these are not generated as files
  const isUri = ref.startsWith('http://') || ref.startsWith('https://')
  if (isUri && (ref.includes('#/properties/') || ref.includes('#/definitions/'))) {
    return false
  }

  return true
}

/**
 * Determines if an array property should use ref imports for its items.
 */
const shouldUseArrayRefImport = (propSchema: JSONSchema, useRefImports: boolean): boolean => {
  if (!useRefImports) {
    return false
  }
  if (!isSchemaObject(propSchema)) {
    return false
  }
  if (!('type' in propSchema) || propSchema.type !== 'array') {
    return false
  }
  return hasItems(propSchema) && hasRef(propSchema.items)
}

/**
 * Determines if a property with additionalProperties should use ref imports.
 */
const shouldUseRecordRefImport = (propSchema: JSONSchema, useRefImports: boolean): boolean => {
  if (!useRefImports) {
    return false
  }
  if (!isSchemaObject(propSchema)) {
    return false
  }
  if (!('type' in propSchema) || propSchema.type !== 'object') {
    return false
  }
  if (!('additionalProperties' in propSchema)) {
    return false
  }
  const additionalProps = propSchema.additionalProperties
  return isSchemaObject(additionalProps) && hasRef(additionalProps)
}

/**
 * Generates the value expression for a property based on its schema and options.
 */
const generatePropertyValue = (
  key: string,
  propSchema: JSONSchema,
  isRequired: boolean,
  useRefImports: boolean,
): string => {
  // Handle direct $ref properties
  if (shouldUseRefImport(propSchema, useRefImports)) {
    const ref = (propSchema as { $ref: string }).$ref
    return isRequired ? generateRequiredRefCall(key, ref) : generateOptionalRefCall(key, ref)
  }

  // Handle array properties with $ref items
  if (shouldUseArrayRefImport(propSchema, useRefImports)) {
    const items = (propSchema as { items: { $ref: string } }).items
    const ref = items.$ref
    return isRequired ? generateRequiredArrayRefCall(key, ref) : generateOptionalArrayRefCall(key, ref)
  }

  // Handle object properties with additionalProperties $ref
  if (shouldUseRecordRefImport(propSchema, useRefImports)) {
    const additionalProps = (propSchema as { additionalProperties: { $ref: string } }).additionalProperties
    const ref = additionalProps.$ref
    return isRequired ? generateRequiredRecordRefCall(key, ref) : generateOptionalRecordRefCall(key, ref)
  }

  // Handle non-schema object properties (true/false)
  if (!isSchemaObject(propSchema)) {
    return isRequired ? 'undefined' : generateOptionalInlineProperty(key, 'undefined')
  }

  // Generate standard validation expression
  const defaultValue = getDefaultValue(propSchema)
  const valueExpression = generateValidationExpression(key, propSchema, defaultValue, isRequired)
  return isRequired ? valueExpression : generateOptionalInlineProperty(key, valueExpression)
}

/**
 * Generates property entries for all properties in the schema.
 */
const generatePropertyEntries = (schema: JSONSchema, useRefImports: boolean): PropertyEntry[] => {
  if (!hasProperties(schema)) {
    return []
  }

  const entries: PropertyEntry[] = []

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = isPropertyRequired(key, schema)
    const value = generatePropertyValue(key, propSchema, isRequired, useRefImports)

    // Determine if the property uses spread syntax (making it optional in the object literal)
    const isOptional = value.startsWith('...')

    entries.push({ key, value, isOptional })
  }

  return entries
}

/**
 * Generates a fallback value for a required property.
 * This returns simple type-based defaults without pattern inference,
 * matching TypeBox's coercion behavior.
 */
const generateFallbackValue = (_: string, propSchema: JSONSchema, useRefImports: boolean): string => {
  // Handle direct $ref properties - call the parser with undefined
  if (useRefImports && hasRef(propSchema)) {
    const ref = (propSchema as { $ref: string }).$ref
    const parserName = generateParserName(refToName(ref))
    return `${parserName}(undefined)`
  }

  // Handle array properties with $ref items
  if (
    useRefImports &&
    isSchemaObject(propSchema) &&
    propSchema.type === 'array' &&
    hasItems(propSchema) &&
    hasRef(propSchema.items)
  ) {
    return '[]'
  }

  // Handle object properties with additionalProperties $ref
  if (
    useRefImports &&
    isSchemaObject(propSchema) &&
    propSchema.type === 'object' &&
    'additionalProperties' in propSchema
  ) {
    const additionalProps = propSchema.additionalProperties
    if (isSchemaObject(additionalProps) && hasRef(additionalProps)) {
      return '{}'
    }
  }

  // For non-schema objects, return undefined
  if (!isSchemaObject(propSchema)) {
    return 'undefined'
  }

  // Use explicit default if provided
  if (hasDefault(propSchema)) {
    return JSON.stringify(propSchema.default)
  }

  // Use first enum value if available
  if (hasEnum(propSchema) && propSchema.enum.length > 0) {
    return JSON.stringify(propSchema.enum[0])
  }

  // Use first example if available
  if (hasExamples(propSchema) && propSchema.examples.length > 0) {
    return JSON.stringify(propSchema.examples[0])
  }

  // Return simple type-based defaults without pattern inference
  if (!hasType(propSchema)) {
    return 'undefined'
  }

  switch (propSchema.type) {
    case 'string':
      return '""'
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

/**
 * Generates a fallback object with required properties filled with default values.
 * This is used when input is not an object (undefined, null, etc.).
 */
const generateFallbackObject = (schema: JSONSchema, useRefImports: boolean, typeName: string): string => {
  if (!hasProperties(schema)) {
    return `{} as ${typeName}`
  }

  // For schemas with conditional branches (if/then/else), the merged properties
  // may not fully represent all required fields. Use a simple cast to avoid
  // generating incomplete fallback objects.
  if (isSchemaObject(schema) && ('if' in schema || 'then' in schema || 'else' in schema)) {
    return `{} as ${typeName}`
  }

  const requiredProps: string[] = []

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = isPropertyRequired(key, schema)
    if (isRequired) {
      const fallbackValue = generateFallbackValue(key, propSchema, useRefImports)
      if (fallbackValue === 'undefined') {
        return `{} as ${typeName}`
      }
      requiredProps.push(`        ${safeKey(key)}: ${fallbackValue},`)
    }
  }

  if (requiredProps.length === 0) {
    return `{} as ${typeName}`
  }

  let result = '{\n'
  for (let i = 0; i < requiredProps.length; i++) {
    result += requiredProps[i]
    if (i < requiredProps.length - 1) {
      result += '\n'
    }
  }
  result += '\n      }'
  return result
}

/**
 * Generates a parser for non-object schemas (string, number, boolean, array, etc.)
 * that validates the input matches the expected primitive type before casting.
 */
const generateNonObjectParser = (typeName: string, schema: JSONSchema): string => {
  const functionName = generateParserName(typeName)

  if (!isSchemaObject(schema) || !hasType(schema)) {
    // Schema without type information cannot be validated beyond a cast
    return `export const ${functionName} = (input: unknown): ${typeName} => input as ${typeName};`
  }

  switch (schema.type) {
    case 'string':
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "string" ? input as ${typeName} : "" as ${typeName};`
    case 'number':
    case 'integer':
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "number" ? input as ${typeName} : 0 as ${typeName};`
    case 'boolean':
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "boolean" ? input as ${typeName} : false as ${typeName};`
    case 'array':
      return `export const ${functionName} = (input: unknown): ${typeName} => Array.isArray(input) ? [...input] as ${typeName} : [] as ${typeName};`
    default:
      return `export const ${functionName} = (input: unknown): ${typeName} => input as ${typeName};`
  }
}

/**
 * Generates a parser for empty object schemas or schemas with only additionalProperties.
 * Validates the input is an object before casting, falling back to an empty object.
 * Returns a shallow copy to avoid mutating the original input.
 */
const generateEmptyObjectParser = (typeName: string): string => {
  const functionName = generateParserName(typeName)
  return `export const ${functionName} = (input: unknown): ${typeName} => isObject(input) ? { ...input } as ${typeName} : {} as ${typeName};`
}

/**
 * Converts a property key to a safe local variable name for caching.
 * Replaces non-identifier characters with underscores.
 */
const toVarName = (key: string): string => {
  const safe = key.replace(/[^a-zA-Z0-9_$]/g, '_')
  return `_${safe}`
}

/**
 * Returns the shape-predicate function name for a given type name.
 * The predicate is generated alongside each parser and tells callers
 * whether `input` is already in the shape produced by the parser's fast path.
 */
const shapeValidatorName = (typeName: string): string => `validate${typeName}Shape`

/**
 * Generates a fast-path type check expression for a property.
 * Returns null if the schema is too complex for a simple type check
 * (e.g. has unions, enums that require more elaborate validation).
 *
 * When `useRefImports` is true, $ref properties (and arrays of $refs) are
 * checked by calling the imported shape predicate, allowing parent parsers
 * to fast-path through nested ref types without recursing into their parsers.
 */
const generatePropertyTypeCheck = (varName: string, schema: JSONSchema, useRefImports: boolean): string | null => {
  if (!isSchemaObject(schema)) return null

  // $ref via shape predicate (deep fast-path through nested types).
  if (useRefImports && hasRef(schema)) {
    const refName = refToName((schema as { $ref: string }).$ref)
    return `${shapeValidatorName(refName)}(${varName})`
  }

  // Skip fast path for complex schemas that need more elaborate validation
  if (
    hasEnum(schema) ||
    hasOneOf(schema) ||
    hasAnyOf(schema) ||
    hasAllOf(schema) ||
    hasRef(schema) ||
    'not' in schema
  ) {
    return null
  }

  if (!hasType(schema)) return null

  // Array of $refs: each item must satisfy the imported shape predicate.
  if (
    useRefImports &&
    schema.type === 'array' &&
    hasItems(schema) &&
    isSchemaObject(schema.items) &&
    hasRef(schema.items)
  ) {
    const refName = refToName((schema.items as { $ref: string }).$ref)
    return `Array.isArray(${varName}) && ${varName}.every(${shapeValidatorName(refName)})`
  }

  const checks: string[] = []

  switch (schema.type) {
    case 'string': {
      checks.push(`typeof ${varName} === "string"`)
      if (hasPattern(schema)) checks.push(`/${escapeRegexPattern(schema.pattern)}/.test(${varName})`)
      if (hasMinLength(schema)) checks.push(`${varName}.length >= ${schema.minLength}`)
      if (hasMaxLength(schema)) checks.push(`${varName}.length <= ${schema.maxLength}`)
      break
    }
    case 'number':
    case 'integer': {
      checks.push(`typeof ${varName} === "number"`)
      if (hasMinimum(schema)) checks.push(`${varName} >= ${schema.minimum}`)
      if (hasMaximum(schema)) checks.push(`${varName} <= ${schema.maximum}`)
      if (hasExclusiveMinimum(schema)) checks.push(`${varName} > ${schema.exclusiveMinimum}`)
      if (hasExclusiveMaximum(schema)) checks.push(`${varName} < ${schema.exclusiveMaximum}`)
      if (hasMultipleOf(schema)) checks.push(`${varName} % ${schema.multipleOf} === 0`)
      break
    }
    case 'boolean':
      checks.push(`typeof ${varName} === "boolean"`)
      break
    case 'array': {
      checks.push(`Array.isArray(${varName})`)
      if (hasMinItems(schema)) checks.push(`${varName}.length >= ${schema.minItems}`)
      if (hasMaxItems(schema)) checks.push(`${varName}.length <= ${schema.maxItems}`)
      if (hasUniqueItems(schema) && schema.uniqueItems === true) {
        checks.push(`new Set(${varName}).size === ${varName}.length`)
      }
      break
    }
    case 'object':
      checks.push(`isObject(${varName})`)
      break
    default:
      return null
  }

  if (checks.length === 0) return null
  // checks[0] is safe: we guard with checks.length === 0 above
  let result = checks[0] as string
  for (let i = 1; i < checks.length; i++) {
    result += ' && ' + checks[i]
  }
  return result
}

/**
 * Determines if a property needs a local variable or can be inlined.
 * Schema-object properties are always cached: the slow-path ternary chain
 * reads each value 3-4x (typeof check, valid branch, undefined check, coerce),
 * so a single hoisted load is strictly cheaper than the inlined optional chain.
 */
const shouldCacheVariable = (propSchema: JSONSchema, _canFastPath: boolean, _useRefImports: boolean): boolean => {
  // Non-schema-object properties (true/false JSON Schema literals) generate
  // `undefined` with no value access, so caching would be wasted.
  return isSchemaObject(propSchema)
}

/**
 * Generates a parser for object schemas with properties.
 *
 * Uses an optimized function body with:
 * - Early return for non-object input
 * - Selective variable caching (only when needed)
 * - Fast path that returns input directly when all properties are already valid
 * - Slow path with optimized expressions
 */
const generateObjectParser = (
  schema: JSONSchema,
  typeName: string,
  useRefImports: boolean,
  logUnmatched?: boolean,
): string => {
  const functionName = generateParserName(typeName)

  if (!hasProperties(schema)) {
    return `export const ${functionName} = (input: unknown): ${typeName} => isObject(input) ? input as ${typeName} : {} as ${typeName};`
  }

  const fallbackObject = generateFallbackObject(schema, useRefImports, typeName)
  const properties = Object.entries((schema as { properties: Record<string, JSONSchema> }).properties)

  const lines: string[] = []
  lines.push(`export const ${functionName} = (input: unknown): ${typeName} => {`)
  lines.push(`  if (!isObject(input)) return ${fallbackObject};`)

  // First pass: determine if we can generate a fast path
  const propInfo: {
    readonly key: string
    readonly varName: string
    readonly isRequired: boolean
    readonly propSchema: JSONSchema
  }[] = []

  // Disable fast path when allOf $ref parsers need to be spread — the fast path
  // returns input as-is and would skip those coercions.
  const hasAllOfRefParsers =
    useRefImports &&
    isSchemaObject(schema) &&
    hasAllOf(schema) &&
    schema.allOf.some((entry) => isSchemaObject(entry) && hasRef(entry))

  let canFastPath = !hasAllOfRefParsers
  const fastPathChecks: string[] = []

  for (const [key, propSchema] of properties) {
    const isRequired = isPropertyRequired(key, schema)
    const varName = toVarName(key)
    propInfo.push({ key, varName, isRequired, propSchema })

    // Check if this property can participate in fast path
    if (canFastPath) {
      // Records of refs require iterating every value to check shape — too
      // expensive to inline into the parser's fast path. Disable.
      if (shouldUseRecordRefImport(propSchema, useRefImports)) {
        canFastPath = false
      } else {
        const check = generatePropertyTypeCheck(varName, propSchema, useRefImports)
        if (check === null) {
          canFastPath = false
        } else {
          if (isRequired) {
            fastPathChecks.push(check)
          } else {
            fastPathChecks.push(`(${varName} === undefined || ${check})`)
          }
        }
      }
    }
  }

  // Second pass: generate variable declarations only for properties that need them
  for (const { key, varName, propSchema } of propInfo) {
    if (shouldCacheVariable(propSchema, canFastPath, useRefImports)) {
      lines.push(`  const ${varName} = ${safeAccessor('input', key)};`)
    }
  }

  // Emit a warning for any input key not declared in the schema's properties
  if (logUnmatched && propInfo.length > 0) {
    const keysList = propInfo.map(({ key }) => JSON.stringify(key)).join(', ')
    lines.push(`  const _knownKeys = new Set([${keysList}]);`)
    lines.push(`  for (const _k in input) {`)
    lines.push(`    if (!_knownKeys.has(_k)) {`)
    lines.push(`      console.warn(\`[${typeName}] Unknown property "\${_k}"\`);`)
    lines.push(`    }`)
    lines.push(`  }`)
  }

  // Generate fast-path check if possible
  if (canFastPath && fastPathChecks.length > 0) {
    let fastPathExpr = fastPathChecks[0]
    for (let i = 1; i < fastPathChecks.length; i++) {
      fastPathExpr += ' && ' + fastPathChecks[i]
    }
    lines.push(`  if (${fastPathExpr}) return { ...input } as ${typeName};`)
  }

  // Generate slow-path object construction
  const objectLines: string[] = []
  objectLines.push('    ...input,')

  // Spread allOf $ref parsers so their field coercions are applied before
  // the explicit property validations below.
  if (useRefImports && isSchemaObject(schema) && hasAllOf(schema)) {
    for (const entry of schema.allOf) {
      if (isSchemaObject(entry) && hasRef(entry)) {
        const parserName = generateParserName(refToName(entry.$ref))
        objectLines.push(`    ...(${parserName}(input) as Record<string, unknown>),`)
      }
    }
  }

  for (const { key, varName, isRequired, propSchema } of propInfo) {
    const shouldCache = shouldCacheVariable(propSchema, canFastPath, useRefImports)
    const accessor = shouldCache ? varName : safeAccessor('input', key)

    // Handle direct $ref properties via imported parsers
    if (shouldUseRefImport(propSchema, useRefImports)) {
      const ref = (propSchema as { $ref: string }).$ref
      const parserName = generateParserName(refToName(ref))
      if (isRequired) {
        objectLines.push(`    ${safeKey(key)}: ${parserName}(${accessor}),`)
      } else {
        objectLines.push(`    ...(${accessor} !== undefined && { ${safeKey(key)}: ${parserName}(${accessor}) }),`)
      }
      continue
    }

    // Handle array properties with $ref items
    if (shouldUseArrayRefImport(propSchema, useRefImports)) {
      const items = (propSchema as { items: { $ref: string } }).items
      const ref = items.$ref
      const parserName = generateParserName(refToName(ref))
      if (isRequired) {
        objectLines.push(`    ${safeKey(key)}: validateArray(${accessor}, ${parserName}),`)
      } else {
        objectLines.push(
          `    ...(${accessor} !== undefined && { ${safeKey(key)}: validateArray(${accessor}, ${parserName}) }),`,
        )
      }
      continue
    }

    // Handle object properties with additionalProperties $ref
    if (shouldUseRecordRefImport(propSchema, useRefImports)) {
      const additionalProps = (propSchema as { additionalProperties: { $ref: string } }).additionalProperties
      const ref = additionalProps.$ref
      const parserName = generateParserName(refToName(ref))
      if (isRequired) {
        objectLines.push(`    ${safeKey(key)}: validateRecord(${accessor}, ${parserName}),`)
      } else {
        objectLines.push(
          `    ...(${accessor} !== undefined && { ${safeKey(key)}: validateRecord(${accessor}, ${parserName}) }),`,
        )
      }
      continue
    }

    // Handle non-schema-object properties
    if (!isSchemaObject(propSchema)) {
      if (isRequired) {
        objectLines.push(`    ${safeKey(key)}: undefined,`)
      }
      continue
    }

    // Generate validation expression
    const defaultValue = getDefaultValue(propSchema)
    // For optional properties in the slow path, we know the value is not undefined
    // because we're inside the `...(accessor !== undefined && { ... })` check
    const knownNotUndefined = !isRequired
    const valueExpr = generateValidationExpression(
      key,
      propSchema,
      defaultValue,
      true,
      undefined,
      undefined,
      shouldCache ? varName : undefined,
      knownNotUndefined,
    )

    if (isRequired) {
      objectLines.push(`    ${safeKey(key)}: ${valueExpr},`)
    } else {
      objectLines.push(`    ...(${accessor} !== undefined && { ${safeKey(key)}: ${valueExpr} }),`)
    }
  }

  lines.push(`  return {`)
  // objectLines[0] is safe: objectLines is always non-empty (has at least the closing brace line)
  let objectBody = objectLines[0] as string
  for (let i = 1; i < objectLines.length; i++) {
    objectBody += '\n' + objectLines[i]
  }
  lines.push(objectBody)
  lines.push(`  } as unknown as ${typeName};`)
  lines.push(`}`)

  // lines[0] is safe: lines is always non-empty (it always has the function declaration)
  let result = lines[0] as string
  for (let i = 1; i < lines.length; i++) {
    result += '\n' + lines[i]
  }
  return result
}

/**
 * Generates a parser for schemas that have both properties AND patternProperties.
 * Parses the known properties first, then iterates remaining keys to match patterns.
 */
const generateCombinedObjectParser = (
  schema: JSONSchema,
  typeName: string,
  useRefImports: boolean,
  logUnmatched?: boolean,
): string => {
  const functionName = generateParserName(typeName)
  const entries = generatePropertyEntries(schema, useRefImports)

  // Build the known property lines for the initial object
  const propertyLines = entries.map((entry) => {
    if (entry.isOptional) {
      return `    ${entry.value},`
    }
    return `    ${safeKey(entry.key)}: ${entry.value},`
  })

  // Find the first pattern with a $ref for parser delegation
  if (!isSchemaObject(schema) || !('patternProperties' in schema)) {
    return generateObjectParser(schema, typeName, useRefImports, logUnmatched)
  }

  const patternProps = schema.patternProperties as Record<string, JSONSchema>
  const patterns = Object.entries(patternProps)
  const refPattern = patterns.find(([, ps]) => isSchemaObject(ps) && hasRef(ps))

  if (!refPattern || !useRefImports) {
    return generateObjectParser(schema, typeName, useRefImports, logUnmatched)
  }

  const [pattern, patternSchema] = refPattern
  const ref = (patternSchema as { $ref: string }).$ref
  const parserName = generateParserName(refToName(ref))
  const assignmentCode = `(result as Record<string, unknown>)[key] = ${parserName}(value);`

  const escapedPattern = escapeRegexPattern(pattern)

  const inputSpread = '    ...input,'
  let objectProperties = inputSpread
  if (propertyLines.length > 0) {
    for (const line of propertyLines) {
      objectProperties += '\n' + line
    }
  }

  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (!isObject(input)) {
    return {} as unknown as ${typeName};
  }
  const result = {
${objectProperties}
  } as unknown as ${typeName};
  for (const key in input) {
    if (/${escapedPattern}/.test(key)) {
      const value = input[key];
      ${assignmentCode}
    }
  }
  return result;
};`
}

/**
 * Generates a parser for schemas with additionalProperties.
 */
const generateAdditionalPropertiesParser = (
  schema: JSONSchema.Object,
  typeName: string,
  useRefImports: boolean,
): string => {
  const functionName = generateParserName(typeName)
  const additionalProps = schema.additionalProperties

  // Check if additionalProps is defined before using it
  if (!additionalProps) {
    return generateEmptyObjectParser(typeName)
  }

  // If additionalProperties is a $ref and useRefImports is true, generate a loop
  if (useRefImports && isSchemaObject(additionalProps) && hasRef(additionalProps)) {
    const ref = additionalProps.$ref
    const parserName = generateParserName(refToName(ref))

    return `export const ${functionName} = (input: unknown): ${typeName} => validateRecord(input, ${parserName}) as ${typeName};`
  }

  // Handle additionalProperties with a known type by generating inline validation
  if (isSchemaObject(additionalProps) && hasType(additionalProps)) {
    const inlineParser = generateInlineValueParser(additionalProps)
    if (inlineParser) {
      return `export const ${functionName} = (input: unknown): ${typeName} => validateRecord(input, ${inlineParser}) as ${typeName};`
    }
  }

  // Otherwise, just validate the input type and shallow copy
  return `export const ${functionName} = (input: unknown): ${typeName} => isObject(input) ? { ...input } as ${typeName} : {};`
}

/**
 * Generates an inline arrow function that validates a single value based on
 * the additionalProperties schema type. Returns null if the type is not supported.
 *
 * Used to generate parsers for Record-like types where values have a known
 * primitive or array type (e.g. Record<string, string> or Record<string, string[]>).
 */
const generateInlineValueParser = (schema: JSONSchema): string | null => {
  if (!isSchemaObject(schema) || !hasType(schema)) {
    return null
  }

  switch (schema.type) {
    case 'string':
      return '(value: unknown) => typeof value === "string" ? value : ""'
    case 'number':
    case 'integer':
      return '(value: unknown) => typeof value === "number" ? value : 0'
    case 'boolean':
      return '(value: unknown) => typeof value === "boolean" ? value : false'
    case 'array':
      return '(value: unknown) => Array.isArray(value) ? value : []'
    default:
      return null
  }
}

/**
 * Escapes special regex characters in a pattern string for use in a regex literal.
 * This escapes backslashes and forward slashes for safe inclusion in /pattern/ syntax.
 */
const escapeRegexPattern = (pattern: string): string => {
  // Escape backslashes first, then forward slashes
  return pattern.replace(/\\/g, '\\\\').replace(/\//g, '\\/')
}

/**
 * Generates a parser for schemas with patternProperties.
 * Handles both patternProperties and specification-extensions (x- prefix).
 */
const generatePatternPropertiesParser = (
  schema: JSONSchema.Object,
  typeName: string,
  useRefImports: boolean,
): string => {
  const functionName = generateParserName(typeName)

  if (!('patternProperties' in schema) || typeof schema.patternProperties !== 'object') {
    return generateEmptyObjectParser(typeName)
  }

  const patternProps = schema.patternProperties as Record<string, JSONSchema>

  // Find the first pattern and its schema
  const patterns = Object.entries(patternProps)
  if (patterns.length === 0) {
    return generateEmptyObjectParser(typeName)
  }

  const [pattern, patternSchema] = patterns[0] as [string, JSONSchema]
  let patternAssignment = '(result as Record<string, unknown>)[key] = value;'

  // Use imported parser when pattern schema points to a $ref.
  if (useRefImports && isSchemaObject(patternSchema) && hasRef(patternSchema)) {
    const ref = patternSchema.$ref
    const parserName = generateParserName(refToName(ref))
    patternAssignment = `(result as Record<string, unknown>)[key] = ${parserName}(value);`
  } else if (patternSchema === false) {
    // `false` means no values are allowed for matching keys.
    patternAssignment = ''
  }

  // Escape the pattern for safe inclusion in generated code
  const escapedPattern = escapeRegexPattern(pattern)

  // Generate a parser that handles both pattern matching and x- extensions
  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (!isObject(input)) {
    return {} as unknown as ${typeName};
  }
  const result = {
    ...input,
  } as unknown as ${typeName};
  for (const key in input) {
    if (/${escapedPattern}/.test(key)) {
      const value = input[key];
      ${patternAssignment}
    }
  }
  return result;
};`
}

/**
 * Generates a parser for conditional schemas with if/then/else.
 * This always generates parser calls regardless of useRefImports setting,
 * because conditional logic requires delegating to the appropriate parser.
 */
const generateConditionalParser = (schema: JSONSchema.Object, typeName: string): string => {
  const functionName = generateParserName(typeName)

  // Extract the condition and branches
  const ifSchema = schema.if
  const thenSchema = schema.then
  const elseSchema = schema.else

  // Check if branches are defined and have $ref
  const thenHasRef = thenSchema && isSchemaObject(thenSchema) && hasRef(thenSchema)
  const elseHasRef = elseSchema && isSchemaObject(elseSchema) && hasRef(elseSchema)

  if (!thenHasRef || !elseHasRef) {
    // Non-$ref branches (e.g. if/then/else providing defaults for properties).
    // Flatten all three branches into a single object schema and generate a
    // regular object parser from the merged property set.
    const mergedSchema = getConditionalObjectSchema(schema)
    if (mergedSchema) {
      return generateObjectParser(mergedSchema, typeName, false)
    }
    return generateEmptyObjectParser(typeName)
  }

  // Check if the condition is checking for $ref property
  const isRefCondition =
    ifSchema &&
    isSchemaObject(ifSchema) &&
    'required' in ifSchema &&
    Array.isArray(ifSchema.required) &&
    ifSchema.required.includes('$ref')

  if (!isRefCondition) {
    // Condition is not a $ref check — flatten into an object parser
    const mergedSchema = getConditionalObjectSchema(schema)
    if (mergedSchema) {
      return generateObjectParser(mergedSchema, typeName, false)
    }
    return generateEmptyObjectParser(typeName)
  }

  const thenRef = thenSchema.$ref
  const elseRef = elseSchema.$ref

  const thenParserName = generateParserName(refToName(thenRef))
  const elseParserName = generateParserName(refToName(elseRef))
  const thenTypeName = refToName(thenRef)

  return `export const ${functionName} = (input: unknown): ${typeName} | ${thenTypeName} =>
  hasRef(input) ? ${thenParserName}(input) : ${elseParserName}(input)
      `
}

/**
 * Builds an object schema from conditional if/then keywords when the schema does not
 * declare type: "object". Flattens if/then/else property sets into a single object schema.
 */
const getConditionalObjectSchema = (schema: JSONSchema): JSONSchema.Object | null => {
  if (!isSchemaObject(schema)) {
    return null
  }

  if (!('if' in schema) || !('then' in schema)) {
    return null
  }

  const ifSchema = schema.if
  const thenSchema = schema.then
  const elseSchema = 'else' in schema ? schema.else : undefined

  if (!isSchemaObject(ifSchema) || !isSchemaObject(thenSchema)) {
    return null
  }

  const ifProperties = ifSchema.properties
  const thenProperties = thenSchema.properties
  const elseProperties = elseSchema && isSchemaObject(elseSchema) ? elseSchema.properties : undefined
  const hasIfProperties = ifProperties && typeof ifProperties === 'object'
  const hasThenProperties = thenProperties && typeof thenProperties === 'object'
  const hasElseProperties = elseProperties && typeof elseProperties === 'object'

  if (!hasIfProperties && !hasThenProperties && !hasElseProperties) {
    return null
  }

  const required = new Set<string>()

  if (Array.isArray(ifSchema.required)) {
    for (const key of ifSchema.required) {
      required.add(key)
    }
  }

  // If the `if` condition checks for a `const` value on a property, that property
  // is effectively required (the schema only applies when the condition is true).
  if (hasIfProperties && ifProperties && typeof ifProperties === 'object') {
    for (const [key, propSchema] of Object.entries(ifProperties as Record<string, JSONSchema>)) {
      if (isSchemaObject(propSchema) && hasConst(propSchema)) {
        required.add(key)
      }
    }
  }

  if (Array.isArray(thenSchema.required)) {
    for (const key of thenSchema.required) {
      required.add(key)
    }
  }

  return {
    type: 'object',
    properties: {
      // else properties first so then properties take precedence on overlap
      ...(hasElseProperties ? elseProperties : {}),
      ...(hasIfProperties ? ifProperties : {}),
      ...(hasThenProperties ? thenProperties : {}),
    },
    ...(required.size > 0 ? { required: Array.from(required) } : {}),
  }
}

/**
 * Generates a parser for SchemaObject that validates all JSON Schema 2020-12 properties.
 * This handles the special case where a schema can be any valid JSON Schema.
 */
const generateSchemaObjectParser = (typeName: string): string => {
  const functionName = generateParserName(typeName)

  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (typeof input === 'boolean') {
    return input as ${typeName};
  }
  
  if (!isObject(input)) {
    return {} as ${typeName};
  }
  
  return input as ${typeName};
};`
}

/**
 * Determines the appropriate parser generation strategy for a schema.
 */
const selectParserStrategy = (schema: JSONSchema, typeName: string, options?: GenerateParserOptions): string => {
  const useRefImports = options?.useRefImports ?? false
  const logUnmatched = options?.logUnmatched ?? false

  // Special case for SchemaObject - it can be any JSON Schema
  if (typeName === 'SchemaObject') {
    return generateSchemaObjectParser(typeName)
  }

  const isObjectLikeSchema =
    isObjectSchema(schema) ||
    (isSchemaObject(schema) && ('patternProperties' in schema || 'additionalProperties' in schema))

  // Handle non-object schemas with type-appropriate validation
  if (!isObjectLikeSchema && !isSchemaObject(schema)) {
    return generateNonObjectParser(typeName, schema)
  }

  // Handle schemas with both properties AND patternProperties.
  // This generates a parser that handles known properties and also iterates
  // pattern-matched keys (e.g. responses with "default" + "200", "4XX").
  if (hasProperties(schema) && isSchemaObject(schema) && 'patternProperties' in schema) {
    return generateCombinedObjectParser(schema, typeName, useRefImports, logUnmatched)
  }

  // Handle schemas that have explicit properties — generate a full object parser.
  // This intentionally runs before if/then checks so that schemas with both
  // properties AND conditional keywords use all declared properties rather than
  // only the if/then fragment.
  if (hasProperties(schema)) {
    return generateObjectParser(schema, typeName, useRefImports, logUnmatched)
  }

  // Handle conditional schemas (if/then/else) for schemas without explicit properties.
  if (isSchemaObject(schema) && 'if' in schema && 'then' in schema && 'else' in schema) {
    return generateConditionalParser(schema as JSONSchema.Object, typeName)
  }

  // Handle conditional schemas that only define if/then object fragments.
  // We flatten the fragments into a regular object parser.
  const conditionalObjectSchema = getConditionalObjectSchema(schema)
  if (conditionalObjectSchema) {
    return generateObjectParser(conditionalObjectSchema, typeName, useRefImports, logUnmatched)
  }

  // Handle non-object schemas with type-appropriate validation (no properties, no conditionals)
  if (!isObjectLikeSchema) {
    return generateNonObjectParser(typeName, schema)
  }

  // Handle schemas with patternProperties (but no properties)
  if ('patternProperties' in schema) {
    return generatePatternPropertiesParser(schema as JSONSchema.Object, typeName, useRefImports)
  }

  // Handle schemas with additionalProperties as true or false (but no properties)
  if ('additionalProperties' in schema && !hasProperties(schema)) {
    const additionalProps = schema.additionalProperties

    // If additionalProperties is true or false, validate it is an object
    if (additionalProps === true || additionalProps === false) {
      return generateEmptyObjectParser(typeName)
    }

    // Otherwise, handle as a schema (could be a $ref or object schema)
    return generateAdditionalPropertiesParser(schema as JSONSchema.Object, typeName, useRefImports)
  }

  // Handle empty object schemas
  if ('type' in schema && schema.type === 'object' && !hasProperties(schema)) {
    return generateEmptyObjectParser(typeName)
  }

  // Default fallback - validate it is an object since we passed the isObjectSchema check
  return generateEmptyObjectParser(typeName)
}

/**
 * Generates a safe parser as an arrow function that never throws.
 * The parser provides default values for all missing or invalid fields.
 *
 * When useRefImports is enabled, properties with $ref will call the imported
 * parser function (e.g., parseContact(input?.contact)) instead of inlining
 * the resolved schema's validation logic. Array properties whose items are a
 * $ref will map each element through the imported parser.
 */
export const generateParserFunction = (
  schema: JSONSchema,
  typeName: string,
  options?: GenerateParserOptions,
): string => {
  return selectParserStrategy(schema, typeName, options)
}

/**
 * Returns the predicate function name for a generated shape validator.
 * @example shapeValidatorFunctionName('CustomerObject') // 'validateCustomerObjectShape'
 */
export const shapeValidatorFunctionName = (typeName: string): string => shapeValidatorName(typeName)

/**
 * Generates a `validate{TypeName}Shape(input)` predicate that returns true
 * iff `input` already matches the shape produced by the parser's fast path —
 * i.e. the parser would return `{ ...input } as TypeName` without coercion.
 *
 * Parents call this predicate to fast-path through nested ref properties
 * (and arrays of refs) without recursing into their parser.
 *
 * Returns a stub that always returns `false` for schemas that cannot be
 * predicated (composition, conditionals, pattern properties, complex refs
 * in additionalProperties). The stub is safe: parents calling it will fall
 * through to the slow path, matching the pre-deep-fast-path behavior.
 */
export const generateShapeValidator = (schema: JSONSchema, typeName: string, useRefImports: boolean): string => {
  const fnName = shapeValidatorName(typeName)
  const stub = `export const ${fnName} = (_input: unknown): boolean => false;`

  if (!isSchemaObject(schema)) return stub
  if (!hasProperties(schema)) return stub

  // Composition / conditional schemas can match in many shapes — bail.
  if (
    hasOneOf(schema) ||
    hasAnyOf(schema) ||
    hasAllOf(schema) ||
    'not' in schema ||
    'patternProperties' in schema ||
    'if' in schema ||
    'then' in schema ||
    'else' in schema
  ) {
    return stub
  }

  const properties = Object.entries((schema as { properties: Record<string, JSONSchema> }).properties)
  const checks: string[] = []

  for (const [key, propSchema] of properties) {
    // Records of refs require iterating every value — too expensive for the fast path.
    if (shouldUseRecordRefImport(propSchema, useRefImports)) {
      return stub
    }

    const accessor = safeAccessor('input', key)
    const isRequired = isPropertyRequired(key, schema)
    const check = generatePropertyTypeCheck(accessor, propSchema, useRefImports)
    if (check === null) {
      return stub
    }

    if (isRequired) {
      checks.push(check)
    } else {
      checks.push(`(${accessor} === undefined || ${check})`)
    }
  }

  if (checks.length === 0) {
    return `export const ${fnName} = (input: unknown): boolean => isObject(input);`
  }

  let body = checks[0] as string
  for (let i = 1; i < checks.length; i++) {
    body += '\n    && ' + checks[i]
  }

  return `export const ${fnName} = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return ${body};
};`
}
