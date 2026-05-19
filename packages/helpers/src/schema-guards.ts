import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

type SchemaObject = Exclude<JSONSchema, false | boolean>

/** Type guard to check if schema is not false */
export const isSchemaObject = (schema: JSONSchema): schema is SchemaObject => {
  return typeof schema === 'object' && schema !== null && typeof schema !== 'boolean'
}

/** Type guard to check if schema has a type property */
export const hasType = (schema: JSONSchema): schema is SchemaObject & { type: string } => {
  return isSchemaObject(schema) && 'type' in schema && typeof schema.type === 'string'
}

/** Type guard to check if schema is an object schema */
export const isObjectSchema = (schema: JSONSchema): schema is JSONSchema.Object => {
  return isSchemaObject(schema) && (('type' in schema && schema.type === 'object') || 'properties' in schema)
}

/** Type guard to check if schema has properties */
export const hasProperties = (
  schema: JSONSchema,
): schema is SchemaObject & { properties: Record<string, JSONSchema> } => {
  return (
    isSchemaObject(schema) &&
    'properties' in schema &&
    typeof schema.properties === 'object' &&
    schema.properties !== null
  )
}

/** Type guard to check if schema has enum */
export const hasEnum = (schema: JSONSchema): schema is SchemaObject & { enum: readonly unknown[] } => {
  return isSchemaObject(schema) && 'enum' in schema && Array.isArray(schema.enum)
}

/** Type guard to check if schema has const */
export const hasConst = (schema: JSONSchema): schema is SchemaObject & { const: unknown } => {
  return isSchemaObject(schema) && 'const' in schema
}

/** Type guard to check if schema has pattern */
export const hasPattern = (schema: JSONSchema): schema is SchemaObject & { pattern: string } => {
  return isSchemaObject(schema) && 'pattern' in schema && typeof schema.pattern === 'string'
}

/** Type guard to check if schema has format */
export const hasFormat = (schema: JSONSchema): schema is SchemaObject & { format: string } => {
  return isSchemaObject(schema) && 'format' in schema && typeof schema.format === 'string'
}

/** Type guard to check if schema has default */
export const hasDefault = (schema: JSONSchema): schema is SchemaObject & { default: unknown } => {
  return isSchemaObject(schema) && 'default' in schema
}

/** Type guard to check if schema has examples */
export const hasExamples = (schema: JSONSchema): schema is SchemaObject & { examples: readonly unknown[] } => {
  return isSchemaObject(schema) && 'examples' in schema && Array.isArray(schema.examples)
}

/** Type guard to check if schema has oneOf */
export const hasOneOf = (schema: JSONSchema): schema is SchemaObject & { oneOf: readonly JSONSchema[] } => {
  return isSchemaObject(schema) && 'oneOf' in schema && Array.isArray(schema.oneOf)
}

/** Type guard to check if schema has anyOf */
export const hasAnyOf = (schema: JSONSchema): schema is SchemaObject & { anyOf: readonly JSONSchema[] } => {
  return isSchemaObject(schema) && 'anyOf' in schema && Array.isArray(schema.anyOf)
}

/** Type guard to check if schema has allOf */
export const hasAllOf = (schema: JSONSchema): schema is SchemaObject & { allOf: readonly JSONSchema[] } => {
  return isSchemaObject(schema) && 'allOf' in schema && Array.isArray(schema.allOf)
}

/** Type guard to check if schema has required */
export const hasRequired = (schema: JSONSchema): schema is SchemaObject & { required: readonly string[] } => {
  return isSchemaObject(schema) && 'required' in schema && Array.isArray(schema.required)
}

/** Type guard to check if schema has items (and it's not just boolean) */
export const hasItems = (schema: JSONSchema): schema is SchemaObject & { items: SchemaObject } => {
  return (
    isSchemaObject(schema) &&
    'items' in schema &&
    typeof schema.items === 'object' &&
    schema.items !== null &&
    typeof schema.items !== 'boolean'
  )
}

/** Type guard to check if schema has additionalProperties */
export const hasAdditionalProperties = (
  schema: JSONSchema,
): schema is SchemaObject & { additionalProperties: JSONSchema | boolean } => {
  return isSchemaObject(schema) && 'additionalProperties' in schema
}

/** Type guard to check if schema has minLength */
export const hasMinLength = (schema: JSONSchema): schema is SchemaObject & { minLength: number } => {
  return isSchemaObject(schema) && 'minLength' in schema && typeof schema.minLength === 'number'
}

/** Type guard to check if schema has maxLength */
export const hasMaxLength = (schema: JSONSchema): schema is SchemaObject & { maxLength: number } => {
  return isSchemaObject(schema) && 'maxLength' in schema && typeof schema.maxLength === 'number'
}

/** Type guard to check if schema has minimum */
export const hasMinimum = (schema: JSONSchema): schema is SchemaObject & { minimum: number } => {
  return isSchemaObject(schema) && 'minimum' in schema && typeof schema.minimum === 'number'
}

/** Type guard to check if schema has maximum */
export const hasMaximum = (schema: JSONSchema): schema is SchemaObject & { maximum: number } => {
  return isSchemaObject(schema) && 'maximum' in schema && typeof schema.maximum === 'number'
}

/** Type guard to check if schema has exclusiveMinimum */
export const hasExclusiveMinimum = (schema: JSONSchema): schema is SchemaObject & { exclusiveMinimum: number } => {
  return isSchemaObject(schema) && 'exclusiveMinimum' in schema && typeof schema.exclusiveMinimum === 'number'
}

/** Type guard to check if schema has exclusiveMaximum */
export const hasExclusiveMaximum = (schema: JSONSchema): schema is SchemaObject & { exclusiveMaximum: number } => {
  return isSchemaObject(schema) && 'exclusiveMaximum' in schema && typeof schema.exclusiveMaximum === 'number'
}

/** Type guard to check if schema has multipleOf */
export const hasMultipleOf = (schema: JSONSchema): schema is SchemaObject & { multipleOf: number } => {
  return isSchemaObject(schema) && 'multipleOf' in schema && typeof schema.multipleOf === 'number'
}

/** Type guard to check if schema has minItems */
export const hasMinItems = (schema: JSONSchema): schema is SchemaObject & { minItems: number } => {
  return isSchemaObject(schema) && 'minItems' in schema && typeof schema.minItems === 'number'
}

/** Type guard to check if schema has maxItems */
export const hasMaxItems = (schema: JSONSchema): schema is SchemaObject & { maxItems: number } => {
  return isSchemaObject(schema) && 'maxItems' in schema && typeof schema.maxItems === 'number'
}

/** Type guard to check if schema has uniqueItems */
export const hasUniqueItems = (schema: JSONSchema): schema is SchemaObject & { uniqueItems: boolean } => {
  return isSchemaObject(schema) && 'uniqueItems' in schema && typeof schema.uniqueItems === 'boolean'
}

/** Type guard to check if schema has minProperties */
export const hasMinProperties = (schema: JSONSchema): schema is SchemaObject & { minProperties: number } => {
  return isSchemaObject(schema) && 'minProperties' in schema && typeof schema.minProperties === 'number'
}

/** Type guard to check if schema has maxProperties */
export const hasMaxProperties = (schema: JSONSchema): schema is SchemaObject & { maxProperties: number } => {
  return isSchemaObject(schema) && 'maxProperties' in schema && typeof schema.maxProperties === 'number'
}

export { hasRef } from './has-ref'
