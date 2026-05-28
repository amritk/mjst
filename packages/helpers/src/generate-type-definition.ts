import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { getMjstBrand, getMjstInstanceOf, getMjstPrimitive } from './mjst-extension'
import { refToName } from './ref-to-name'
import { safeKey } from './safe-accessor'
import { isObjectSchema, isSchemaObject } from './schema-guards'

type ConditionalObjectResult = {
  schema: JSONSchema.Object
  thenRef: string | null
}

/** Options controlling generated type output. */
export type TypeOptions = {
  /** When true, every property, array, and record in the generated types is emitted as readonly. */
  readonly readonly?: boolean
}

const getConditionalObjectSchema = (schema: JSONSchema): ConditionalObjectResult | null => {
  if (!isSchemaObject(schema)) {
    return null
  }

  if (!('if' in schema) || !('then' in schema)) {
    return null
  }

  const ifSchema = schema.if
  const thenSchema = schema.then

  if (!isSchemaObject(ifSchema) || !isSchemaObject(thenSchema)) {
    return null
  }

  const ifProperties = ifSchema.properties
  const thenProperties = thenSchema.properties
  const hasIfProperties = ifProperties && typeof ifProperties === 'object'
  const hasThenProperties = thenProperties && typeof thenProperties === 'object'

  if (!hasIfProperties && !hasThenProperties) {
    return null
  }

  const properties = {
    ...(hasIfProperties ? ifProperties : {}),
    ...(hasThenProperties ? thenProperties : {}),
  }

  const required = new Set<string>()

  if (Array.isArray(ifSchema.required)) {
    for (const key of ifSchema.required) {
      required.add(key)
    }
  }

  if (hasIfProperties) {
    for (const key in ifProperties) {
      required.add(key)
    }
  }

  if (Array.isArray(thenSchema.required)) {
    for (const key of thenSchema.required) {
      required.add(key)
    }
  }

  if (hasThenProperties) {
    for (const key in thenProperties) {
      required.add(key)
    }
  }

  const thenRef = typeof thenSchema.$ref === 'string' ? thenSchema.$ref : null

  return {
    schema: {
      type: 'object',
      properties,
      ...(required.size > 0 ? { required: Array.from(required) } : {}),
    },
    thenRef,
  }
}

const isObjectLikeSchema = (schema: JSONSchema): schema is JSONSchema.Object => {
  if (!isSchemaObject(schema)) {
    return false
  }

  if (isObjectSchema(schema)) {
    return true
  }

  return 'patternProperties' in schema || 'additionalProperties' in schema || ('if' in schema && 'then' in schema)
}

const getBooleanSubSchemaType = (schema: boolean): string => {
  return schema ? 'unknown' : 'never'
}

const buildJsDocBlock = (title: string, description: string, commentUrl?: string): string => {
  let block = `/**\n`
  block += `* ${title}\n`
  block += `*\n`
  block += `* ${description}\n`
  if (commentUrl?.startsWith('http')) {
    block += `* \n`
    block += `* @see {@link ${commentUrl}}\n`
  }
  block += `*/\n`
  return block
}

/**
 * Converts a JSON Schema type to its TypeScript equivalent, applying any
 * `x-mjst` brand. Branding is type-level only, so we compute the underlying
 * type and intersect it with a unique brand marker. This is the recursion entry
 * point, so branded nested fields are wrapped too.
 */
const getTypeScriptType = (schema: JSONSchema, options: TypeOptions = {}): string => {
  const base = getUnbrandedType(schema, options)
  const brand = getMjstBrand(schema)
  return brand ? `(${base} & { readonly __brand: '${brand}' })` : base
}

/** Wraps a `Record<...>` in `Readonly<...>` when readonly output is requested. */
const recordType = (keyType: string, valueType: string, options: TypeOptions): string =>
  options.readonly ? `Readonly<Record<${keyType}, ${valueType}>>` : `Record<${keyType}, ${valueType}>`

/**
 * Converts a JSON Schema type to its TypeScript equivalent, ignoring any brand.
 * Recursively handles nested objects and arrays.
 */
const getUnbrandedType = (schema: JSONSchema, options: TypeOptions = {}): string => {
  // Boolean schema: `true` means any value is valid (unknown), `false` means no value is valid (never)
  if (typeof schema === 'boolean') {
    return getBooleanSubSchemaType(schema)
  }

  // Check if schema is an object (not a boolean schema)
  if (typeof schema !== 'object' || schema === null) {
    return 'unknown'
  }

  // An x-mjst instanceOf hint means the value is a runtime class (e.g. Date)
  // that JSON Schema cannot describe — emit the class name as the type directly.
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return instanceOf
  }

  // An x-mjst primitive hint (e.g. bigint) names a non-JSON primitive — emit it
  // directly as the TypeScript type.
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return primitive
  }

  // Handle $ref
  if (schema.$ref) {
    // External refs (e.g. http://json-schema.org/...) cannot be resolved locally — treat as unknown
    if (!schema.$ref.startsWith('#')) {
      return 'unknown'
    }
    return refToName(schema.$ref)
  }

  // Handle $dynamicRef (used for recursive schemas)
  if (schema.$dynamicRef) {
    // For #meta, this refers to the Schema type itself (JSON Schema 2020-12 $dynamicAnchor pattern)
    if (schema.$dynamicRef === '#meta') {
      return 'Schema'
    }
    return refToName(schema.$dynamicRef)
  }

  // Handle const - literal type
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const)
  }

  // Handle enum - union of literal types
  if (schema.enum && schema.enum.length > 0) {
    if (schema.enum.length === 1) {
      return JSON.stringify(schema.enum[0])
    }
    let enumUnion = JSON.stringify(schema.enum[0])
    for (let i = 1; i < schema.enum.length; i++) {
      enumUnion += ' | ' + JSON.stringify(schema.enum[i])
    }
    return enumUnion
  }

  // Handle multi-value enum - union of literal types
  if (schema.enum && schema.enum.length > 1) {
    let multiEnumUnion = JSON.stringify(schema.enum[0])
    for (let i = 1; i < schema.enum.length; i++) {
      multiEnumUnion += ' | ' + JSON.stringify(schema.enum[i])
    }
    return multiEnumUnion
  }

  // Handle union types (oneOf, anyOf) - check this before returning unknown
  if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    // schema.oneOf[0] is safe: we guard with .length > 0 above
    let oneOfUnion = getTypeScriptType(schema.oneOf[0]!, options)
    for (let i = 1; i < schema.oneOf.length; i++) {
      oneOfUnion += ' | ' + getTypeScriptType(schema.oneOf[i]!, options)
    }
    return oneOfUnion
  }
  if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    // schema.anyOf[0] is safe: we guard with .length > 0 above
    let anyOfUnion = getTypeScriptType(schema.anyOf[0]!, options)
    for (let i = 1; i < schema.anyOf.length; i++) {
      anyOfUnion += ' | ' + getTypeScriptType(schema.anyOf[i]!, options)
    }
    return anyOfUnion
  }

  // Handle allOf (intersection types)
  if (schema.allOf && Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    // schema.allOf[0] is safe: we guard with .length > 0 above
    let intersectionTypes = getTypeScriptType(schema.allOf[0]!, options)
    for (let i = 1; i < schema.allOf.length; i++) {
      intersectionTypes += ' & ' + getTypeScriptType(schema.allOf[i]!, options)
    }
    return intersectionTypes
  }

  // Handle object-like conditional schemas that use if/then without declaring type
  const conditionalResult = getConditionalObjectSchema(schema)
  if (conditionalResult) {
    const baseType = getTypeScriptType(conditionalResult.schema, options)
    if (conditionalResult.thenRef) {
      return `(${baseType}) & ${refToName(conditionalResult.thenRef)}`
    }
    return baseType
  }

  // No type so we return unknown
  if (!schema.type) {
    if (schema.additionalProperties !== undefined) {
      if (typeof schema.additionalProperties === 'boolean') {
        return recordType('string', getBooleanSubSchemaType(schema.additionalProperties), options)
      }
      return recordType('string', getTypeScriptType(schema.additionalProperties, options), options)
    }

    if (schema.patternProperties && typeof schema.patternProperties === 'object') {
      const firstEntry = Object.entries(schema.patternProperties)[0]
      if (firstEntry) {
        const [pattern, value] = firstEntry
        if (value !== undefined) {
          const valueType =
            typeof value === 'boolean' ? getBooleanSubSchemaType(value) : getTypeScriptType(value, options)
          // The ^x- pattern is a common JSON Schema convention for vendor extensions
          // that maps naturally to the TypeScript template literal `x-${string}`
          if (pattern === '^x-') {
            return recordType('`x-${string}`', valueType, options)
          }
          return recordType('string', valueType, options)
        }
      }
    }

    if (schema.default !== undefined) {
      if (typeof schema.default === 'string') {
        return 'string'
      }
      if (typeof schema.default === 'number') {
        return 'number'
      }
      if (typeof schema.default === 'boolean') {
        return 'boolean'
      }
    }

    return 'unknown'
  }

  // Handle type as an array (union of types)
  if (Array.isArray(schema.type)) {
    const mapType = (t: string): string => {
      switch (t) {
        case 'string':
          return 'string'
        case 'number':
        case 'integer':
          return 'number'
        case 'boolean':
          return 'boolean'
        case 'null':
          return 'null'
        case 'array':
          return 'unknown[]'
        case 'object':
          return 'Record<string, unknown>'
        default:
          return 'unknown'
      }
    }
    let typeUnion = mapType(schema.type[0])
    for (let i = 1; i < schema.type.length; i++) {
      typeUnion += ' | ' + mapType(schema.type[i])
    }
    return typeUnion
  }

  switch (schema.type) {
    // String
    case 'string':
      return 'string'

    // Number
    case 'number':
    case 'integer':
      return 'number'

    // Boolean
    case 'boolean':
      return 'boolean'

    // Array
    case 'array':
      if (schema.items) {
        const itemType = getTypeScriptType(schema.items, options)
        // Wrap union types in parentheses so `(A | B)[]` is not misread as `A | B[]`
        const wrappedItemType = itemType.includes(' | ') ? `(${itemType})` : itemType
        return options.readonly ? `readonly ${wrappedItemType}[]` : `${wrappedItemType}[]`
      }
      return options.readonly ? 'readonly unknown[]' : 'unknown[]'

    // Object
    case 'object':
      if (schema.properties) {
        const readonlyPrefix = options.readonly ? 'readonly ' : ''
        let properties = ''
        let first = true
        for (const key in schema.properties) {
          // schema.properties[key] is safe: key comes from iterating schema.properties
          const propSchema = schema.properties[key]!
          const isRequired = schema.required?.includes(key) ?? false
          const optional = isRequired ? '' : '?'
          const propType = getTypeScriptType(propSchema, options)
          if (!first) properties += '; '
          properties += readonlyPrefix + safeKey(key) + optional + ': ' + propType
          first = false
        }
        return '{ ' + properties + ' }'
      }
      // Handle additionalProperties with $ref or $dynamicRef
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const additionalPropType = getTypeScriptType(schema.additionalProperties, options)
        return recordType('string', additionalPropType, options)
      }
      // Handle patternProperties as a Record type
      if (schema.patternProperties && typeof schema.patternProperties === 'object') {
        const firstEntry = Object.entries(schema.patternProperties)[0]
        if (firstEntry) {
          const [pattern, patternVal] = firstEntry
          if (patternVal) {
            const valueType = getTypeScriptType(patternVal, options)
            if (pattern === '^x-') {
              return recordType('`x-${string}`', valueType, options)
            }
            return recordType('string', valueType, options)
          }
        }
      }
      return 'object'

    // Default to unknown
    default:
      return 'unknown'
  }
}

/**
 * Generates a TypeScript type definition from a JSON Schema.
 * Handles required vs optional properties based on the schema's required array.
 * Uses $comment as inline JSDoc description when present.
 */
export const generateTypeDefinition = (schema: JSONSchema, typeName: string, options: TypeOptions = {}): string => {
  const readonlyPrefix = options.readonly ? 'readonly ' : ''

  // Handle non-object schemas first
  if (!isObjectLikeSchema(schema)) {
    const tsType = getTypeScriptType(schema, options)
    let result = ''

    if (isSchemaObject(schema) && schema.$comment && typeof schema.$comment === 'string') {
      result += buildJsDocBlock(typeName, schema.$comment)
    }

    result += `export type ${typeName} = ${tsType};`
    return result
  }

  if (isObjectLikeSchema(schema)) {
    const conditionalResult = getConditionalObjectSchema(schema)
    const normalizedSchema = conditionalResult?.schema ?? schema
    const conditionalThenRef = conditionalResult?.thenRef ?? null
    let jsDocTitle: string | undefined
    let jsDocDescription: string | undefined

    if (isSchemaObject(schema) && schema.$comment && typeof schema.$comment === 'string') {
      jsDocTitle = typeName
      jsDocDescription = schema.$comment
    }

    const hasProperties = normalizedSchema.properties && Object.keys(normalizedSchema.properties).length > 0
    const hasAdditionalProperties =
      normalizedSchema.additionalProperties && typeof normalizedSchema.additionalProperties === 'object'
    const hasPatternProperties =
      normalizedSchema.patternProperties &&
      typeof normalizedSchema.patternProperties === 'object' &&
      Object.keys(normalizedSchema.patternProperties).length > 0

    // Handle objects with only patternProperties (no fixed properties)
    if (!hasProperties && hasPatternProperties && normalizedSchema.patternProperties) {
      const firstEntry = Object.entries(normalizedSchema.patternProperties)[0]
      const firstPattern = firstEntry?.[0]
      const firstPatternProperty = firstEntry?.[1]

      if (firstPatternProperty === undefined) {
        return `export type ${typeName} = Record<string, unknown>;`
      }

      const patternPropType =
        typeof firstPatternProperty === 'boolean'
          ? getBooleanSubSchemaType(firstPatternProperty)
          : getTypeScriptType(firstPatternProperty, options)

      // The ^x- pattern is a common JSON Schema convention for vendor extensions
      // that maps naturally to the TypeScript template literal `x-${string}`
      const keyType = firstPattern === '^x-' ? '`x-${string}`' : 'string'

      let result = ''
      if (jsDocTitle && jsDocDescription) {
        result += buildJsDocBlock(jsDocTitle, jsDocDescription)
      }
      result += `export type ${typeName} = ${recordType(keyType, patternPropType, options)};`

      return result
    }

    // Handle objects with only additionalProperties (no fixed properties)
    if (!hasProperties && hasAdditionalProperties && normalizedSchema.additionalProperties) {
      const additionalPropType = getTypeScriptType(normalizedSchema.additionalProperties, options)

      let result = ''
      if (jsDocTitle && jsDocDescription) {
        result += buildJsDocBlock(jsDocTitle, jsDocDescription)
      }
      result += `export type ${typeName} = {\n  ${readonlyPrefix}[key: string]: ${additionalPropType};\n};`

      return result
    }

    const schemaProps = normalizedSchema.properties ?? {}
    let properties = ''
    let isFirstProp = true
    for (const key in schemaProps) {
      // schemaProps[key] is safe: key comes from iterating schemaProps
      const propSchema = schemaProps[key]!
      const isRequired = normalizedSchema.required?.includes(key) ?? false
      const optional = isRequired ? '' : '?'
      const propType = getTypeScriptType(propSchema, options)
      const quotedKey = readonlyPrefix + safeKey(key)

      if (!isFirstProp) properties += '\n'
      isFirstProp = false

      // Add JSDoc comment from $comment or description if available
      const inlineDescription =
        isSchemaObject(propSchema) && typeof propSchema.description === 'string'
          ? propSchema.description
          : isSchemaObject(propSchema) && typeof propSchema.$comment === 'string'
            ? propSchema.$comment
            : undefined
      if (inlineDescription) {
        properties += '  /** ' + inlineDescription + ' */\n  ' + quotedKey + optional + ': ' + propType + ';'
      } else {
        properties += '  ' + quotedKey + optional + ': ' + propType + ';'
      }
    }

    // Collect allOf $ref intersections
    const allOfIntersections: string[] = []
    if (isSchemaObject(schema) && Array.isArray(schema.allOf)) {
      for (const entry of schema.allOf) {
        if (isSchemaObject(entry) && entry.$ref) {
          allOfIntersections.push(refToName(entry.$ref))
        }
      }
    }

    // JSON Schema 2019-09+ allows $ref as a sibling to other keywords.
    // Treat it as an additional intersection type (e.g. for specification-extensions).
    if (isSchemaObject(schema) && typeof schema.$ref === 'string' && schema.$ref.startsWith('#')) {
      allOfIntersections.push(refToName(schema.$ref))
    }

    let result = ''
    if (jsDocTitle && jsDocDescription) {
      result += buildJsDocBlock(jsDocTitle, jsDocDescription)
    }

    let typeBody = '{\n' + properties + '\n}'

    if (conditionalThenRef) {
      typeBody += ' & ' + refToName(conditionalThenRef)
    }

    for (const intersectionType of allOfIntersections) {
      typeBody += ' & ' + intersectionType
    }

    result += 'export type ' + typeName + ' = ' + typeBody + ';'

    return result
  }

  return 'export type ' + typeName + ' = unknown;'
}
