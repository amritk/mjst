import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { type ObjectDocumentation, parseDocumentation } from './parse-documentation'
import { refToName } from './ref-to-name'
import { safeKey } from './safe-accessor'
import { isObjectSchema, isSchemaObject } from './schema-guards'

/**
 * Some OpenAPI sections delegate their field definitions to another section
 * rather than repeating them. This map provides the fallback fragment ID so
 * property-level JSDoc can still be resolved.
 *
 * Key: fragment ID of the delegating section (e.g. "header-object")
 * Value: fragment ID of the section that owns the Fixed Fields table
 */
const DOCUMENTATION_FALLBACKS: Record<string, string> = {
  'header-object': 'parameter-object',
}

type ConditionalObjectResult = {
  schema: JSONSchema.Object
  thenRef: string | null
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

  return (
    'patternProperties' in schema || 'additionalProperties' in schema || ('if' in schema && 'then' in schema)
  )
}

const getBooleanSubSchemaType = (schema: boolean): string => {
  return schema ? 'unknown' : 'never'
}

const buildJsDocBlock = (documentation: ObjectDocumentation, commentUrl: string | undefined): string => {
  let block = `/**\n`
  block += `* ${documentation.title}\n`
  block += `*\n`
  block += `* ${documentation.description}\n`
  if (commentUrl?.startsWith('http')) {
    block += `* \n`
    block += `* @see {@link ${commentUrl}}\n`
  }
  block += `*/\n`
  return block
}

/**
 * Converts a JSON Schema type to its TypeScript equivalent.
 * Recursively handles nested objects and arrays.
 */
const getTypeScriptType = (schema: JSONSchema): string => {
  // Boolean schema: `true` means any value is valid (unknown), `false` means no value is valid (never)
  if (typeof schema === 'boolean') {
    return getBooleanSubSchemaType(schema)
  }

  // Check if schema is an object (not a boolean schema)
  if (typeof schema !== 'object' || schema === null) {
    return 'unknown'
  }

  // Handle $ref
  if (schema.$ref) {
    // External refs (e.g. http://json-schema.org/...) cannot be resolved locally — treat as unknown
    if (!schema.$ref.startsWith('#')) {
      return 'unknown'
    }
    // Extract the type name from the $ref (e.g., "#/$defs/contact" -> "Contact")
    const typeName = refToName(schema.$ref)
    // Check if this is a -or-reference ref and add the union type
    if (schema.$ref.includes('-or-reference')) {
      return `${typeName} | ReferenceObject`
    }
    return typeName
  }

  // Handle $dynamicRef (used for recursive schemas)
  if (schema.$dynamicRef) {
    // For #meta, this refers to the Schema type itself
    if (schema.$dynamicRef === '#meta') {
      return 'Schema'
    }
    // Extract the type name from the $dynamicRef
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
    let oneOfUnion = getTypeScriptType(schema.oneOf[0]!)
    for (let i = 1; i < schema.oneOf.length; i++) {
      oneOfUnion += ' | ' + getTypeScriptType(schema.oneOf[i]!)
    }
    return oneOfUnion
  }
  if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    // schema.anyOf[0] is safe: we guard with .length > 0 above
    let anyOfUnion = getTypeScriptType(schema.anyOf[0]!)
    for (let i = 1; i < schema.anyOf.length; i++) {
      anyOfUnion += ' | ' + getTypeScriptType(schema.anyOf[i]!)
    }
    return anyOfUnion
  }

  // Handle allOf (intersection types)
  if (schema.allOf && Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    // schema.allOf[0] is safe: we guard with .length > 0 above
    let intersectionTypes = getTypeScriptType(schema.allOf[0]!)
    for (let i = 1; i < schema.allOf.length; i++) {
      intersectionTypes += ' & ' + getTypeScriptType(schema.allOf[i]!)
    }
    return intersectionTypes
  }

  // Handle object-like conditional schemas that use if/then without declaring type
  const conditionalResult = getConditionalObjectSchema(schema)
  if (conditionalResult) {
    const baseType = getTypeScriptType(conditionalResult.schema)
    if (conditionalResult.thenRef) {
      return `(${baseType}) & ${refToName(conditionalResult.thenRef)}`
    }
    return baseType
  }

  // No type so we return unknown
  if (!schema.type) {
    if (schema.additionalProperties !== undefined) {
      if (typeof schema.additionalProperties === 'boolean') {
        return `Record<string, ${getBooleanSubSchemaType(schema.additionalProperties)}>`
      }
      return `Record<string, ${getTypeScriptType(schema.additionalProperties)}>`
    }

    if (schema.patternProperties && typeof schema.patternProperties === 'object') {
      // Skip ^x- vendor extension patterns; use the first non-extension pattern
      for (const patternKey in schema.patternProperties) {
        if (patternKey.startsWith('^x-') || patternKey === '^x-') continue
        const value = schema.patternProperties[patternKey]
        if (value !== undefined) {
          if (typeof value === 'boolean') {
            return `Record<string, ${getBooleanSubSchemaType(value)}>`
          }
          return `Record<string, ${getTypeScriptType(value)}>`
        }
      }
      // Fall back to first pattern if all are extension patterns
      for (const patternKey in schema.patternProperties) {
        const value = schema.patternProperties[patternKey]
        if (value !== undefined) {
          if (typeof value === 'boolean') {
            return `Record<string, ${getBooleanSubSchemaType(value)}>`
          }
          return `Record<string, ${getTypeScriptType(value)}>`
        }
        break
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
        const itemType = getTypeScriptType(schema.items)
        // Wrap union types in parentheses so `(A | B)[]` is not misread as `A | B[]`
        const wrappedItemType = itemType.includes(' | ') ? `(${itemType})` : itemType
        return `${wrappedItemType}[]`
      }
      return 'unknown[]'

    // Object
    case 'object':
      if (schema.properties) {
        let properties = ''
        let first = true
        for (const key in schema.properties) {
          // schema.properties[key] is safe: key comes from iterating schema.properties
          const propSchema = schema.properties[key]!
          const isRequired = schema.required?.includes(key) ?? false
          const optional = isRequired ? '' : '?'
          const propType = getTypeScriptType(propSchema)
          if (!first) properties += '; '
          properties += safeKey(key) + optional + ': ' + propType
          first = false
        }
        return '{ ' + properties + ' }'
      }
      // Handle additionalProperties with $ref or $dynamicRef
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const additionalPropType = getTypeScriptType(schema.additionalProperties)
        return `Record<string, ${additionalPropType}>`
      }
      // Handle patternProperties as a Record type, skipping ^x- vendor extension patterns
      if (schema.patternProperties && typeof schema.patternProperties === 'object') {
        for (const patternKey in schema.patternProperties) {
          if (patternKey.startsWith('^x-') || patternKey === '^x-') continue
          const patternVal = schema.patternProperties[patternKey]
          if (patternVal) {
            return `Record<string, ${getTypeScriptType(patternVal)}>`
          }
        }
        // Fall back to first pattern if all are extension patterns
        for (const patternKey in schema.patternProperties) {
          const patternVal = schema.patternProperties[patternKey]
          if (patternVal) {
            return `Record<string, ${getTypeScriptType(patternVal)}>`
          }
          break
        }
      }
      return 'object'

    // Default to unknown
    default:
      return 'unknown'
  }
}

const getSecuritySchemeSubtypeNames = (schema: JSONSchema): string[] => {
  if (!isSchemaObject(schema) || !Array.isArray(schema.allOf)) {
    return []
  }

  const subtypeNames: string[] = []
  for (const entry of schema.allOf) {
    if (!isSchemaObject(entry) || !entry.$ref) {
      continue
    }

    if (!entry.$ref.includes('/security-scheme/$defs/type-')) {
      continue
    }

    subtypeNames.push(refToName(entry.$ref))
  }

  return subtypeNames
}

/**
 * Generates a TypeScript type definition from a JSON Schema.
 * Handles required vs optional properties based on the schema's required array.
 * Fetches JSDoc documentation from OpenAPI spec if a $comment URL is provided.
 */
export const generateTypeDefinition = (
  schema: JSONSchema,
  typeName: string,
  markdownDocumentation?: string,
): string => {
  const securitySchemeSubtypeNames = getSecuritySchemeSubtypeNames(schema)
  if (typeName === 'SecuritySchemeObject' && securitySchemeSubtypeNames.length > 0) {
    let result = ''

    if (isSchemaObject(schema) && markdownDocumentation && schema.$comment && typeof schema.$comment === 'string') {
      const documentation = parseDocumentation(markdownDocumentation, schema.$comment)
      if (documentation) {
        result += buildJsDocBlock(documentation, schema.$comment)
      }
    }

    let subtypeUnion = securitySchemeSubtypeNames[0]
    for (let i = 1; i < securitySchemeSubtypeNames.length; i++) {
      subtypeUnion += ' | ' + securitySchemeSubtypeNames[i]
    }
    result += 'export type ' + typeName + ' = ' + subtypeUnion + ';'
    return result
  }

  // Handle non-object schemas first
  if (!isObjectLikeSchema(schema)) {
    const tsType = getTypeScriptType(schema)
    let result = ''

    if (isSchemaObject(schema) && schema.$comment && typeof schema.$comment === 'string') {
      let documentation: ObjectDocumentation | null = null
      if (schema.$comment.startsWith('http')) {
        if (markdownDocumentation) {
          documentation = parseDocumentation(markdownDocumentation, schema.$comment)
        }
      } else {
        documentation = { title: typeName, description: schema.$comment, properties: {} }
      }
      if (documentation) {
        result += buildJsDocBlock(documentation, schema.$comment)
      }
    }

    result += `export type ${typeName} = ${tsType};`
    return result
  }

  if (isObjectLikeSchema(schema)) {
    const conditionalResult = getConditionalObjectSchema(schema)
    const normalizedSchema = conditionalResult?.schema ?? schema
    const conditionalThenRef = conditionalResult?.thenRef ?? null
    let documentation: ObjectDocumentation | null = null

    // Fetch documentation from $comment: URL comments look up the markdown spec,
    // plain-text comments are used directly as the JSDoc description.
    if (schema.$comment && typeof schema.$comment === 'string') {
      if (schema.$comment.startsWith('http')) {
        if (markdownDocumentation) {
          const fragmentId = schema.$comment.split('#')[1]
          const fallbackFragment = fragmentId ? DOCUMENTATION_FALLBACKS[fragmentId] : undefined
          const baseUrl = schema.$comment.split('#')[0]
          const fallbackCommentUrl = fallbackFragment ? `${baseUrl}#${fallbackFragment}` : undefined
          documentation = parseDocumentation(markdownDocumentation, schema.$comment, fallbackCommentUrl)
        }
      } else {
        documentation = { title: typeName, description: schema.$comment, properties: {} }
      }
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
      // Find the first non-extension pattern property (skip ^x- vendor extension patterns,
      // which are inlined as Record<`x-${string}`, unknown> and don't represent the primary type)
      let firstPatternProperty: JSONSchema | undefined
      for (const ppKey in normalizedSchema.patternProperties) {
        if (ppKey.startsWith('^x-') || ppKey === '^x-') continue
        firstPatternProperty = normalizedSchema.patternProperties[ppKey]
        break
      }
      // Fall back to the first pattern property if all are extension patterns
      if (firstPatternProperty === undefined) {
        for (const ppKey in normalizedSchema.patternProperties) {
          firstPatternProperty = normalizedSchema.patternProperties[ppKey]
          break
        }
      }
      if (firstPatternProperty === undefined) {
        return `export type ${typeName} = Record<string, unknown>;`
      }
      if (firstPatternProperty !== undefined) {
        const patternPropType =
          typeof firstPatternProperty === 'boolean'
            ? getBooleanSubSchemaType(firstPatternProperty)
            : getTypeScriptType(firstPatternProperty)

        // Build the type definition with JSDoc header if documentation is available
        let result = ''
        if (documentation) {
          result += buildJsDocBlock(documentation, typeof schema.$comment === 'string' ? schema.$comment : undefined)
        }
        result += `export type ${typeName} = Record<string, ${patternPropType}>;`

        return result
      }
    }

    // Handle objects with only additionalProperties (no fixed properties)
    if (!hasProperties && hasAdditionalProperties && normalizedSchema.additionalProperties) {
      const additionalPropType = getTypeScriptType(normalizedSchema.additionalProperties)

      // Build the type definition with JSDoc header if documentation is available
      let result = ''
      if (documentation) {
        result += buildJsDocBlock(documentation, typeof schema.$comment === 'string' ? schema.$comment : undefined)
      }
      result += `export type ${typeName} = {\n  [key: string]: ${additionalPropType};\n};`

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
      const propType = getTypeScriptType(propSchema)
      const quotedKey = safeKey(key)

      if (!isFirstProp) properties += '\n'
      isFirstProp = false

      // Add JSDoc comment if documentation is available
      const propDoc = documentation?.properties[key]
      const inlineDescription = isSchemaObject(propSchema) && typeof propSchema.description === 'string' ? propSchema.description : undefined
      const jsDocText = propDoc?.description ?? inlineDescription
      if (jsDocText) {
        properties += '  /** ' + jsDocText + ' */\n  ' + quotedKey + optional + ': ' + propType + ';'
      } else {
        properties += '  ' + quotedKey + optional + ': ' + propType + ';'
      }
    }

    // Check if schema has a root-level $ref to specification-extensions
    const hasSpecificationExtensions =
      isSchemaObject(schema) && '$ref' in schema && schema.$ref === '#/$defs/specification-extensions'

    // Collect allOf $ref intersections (excluding specification-extensions, which is handled separately)
    const allOfIntersections: string[] = []
    if (isSchemaObject(schema) && Array.isArray(schema.allOf)) {
      for (const entry of schema.allOf) {
        if (
          isSchemaObject(entry) &&
          entry.$ref &&
          entry.$ref !== '#/$defs/specification-extensions'
        ) {
          allOfIntersections.push(refToName(entry.$ref))
        }
      }
    }

    // Build the type definition with JSDoc header if documentation is available
    let result = ''
    if (documentation) {
      result += buildJsDocBlock(documentation, typeof schema.$comment === 'string' ? schema.$comment : undefined)
    }

    let typeBody = '{\n' + properties + '\n}'

    if (conditionalThenRef) {
      typeBody += ' & ' + refToName(conditionalThenRef)
    }

    for (const intersectionType of allOfIntersections) {
      typeBody += ' & ' + intersectionType
    }

    // If specification-extensions is referenced, append the x-extension intersection
    if (hasSpecificationExtensions) {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: We want the template string to write the type
      typeBody += ' & Record<`x-${string}`, unknown>'
    }

    result += 'export type ' + typeName + ' = ' + typeBody + ';'

    return result
  }

  return 'export type ' + typeName + ' = unknown;'
}
