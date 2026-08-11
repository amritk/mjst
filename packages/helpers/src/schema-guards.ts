import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/*
 * Every guard here asks `Object.hasOwn`, never `'key' in schema`.
 *
 * `in` walks the prototype chain, and these guards run over documents the
 * caller supplied: with `Object.prototype.properties` set by any dependency,
 * `hasProperties` answers true for a schema that has none, and the generators
 * emit types, parsers and imports for a definition nobody declared. Every
 * consumer of this module inherits the answer, so the question is asked
 * correctly once here rather than at each of the hundreds of call sites.
 */

type SchemaObject = Exclude<JSONSchema, false | boolean>

/** Type guard to check if schema is not false */
export const isSchemaObject = (schema: JSONSchema): schema is SchemaObject => {
  return typeof schema === 'object' && schema !== null && typeof schema !== 'boolean'
}

/** Type guard to check if schema has a type property */
export const hasType = (schema: JSONSchema): schema is SchemaObject & { type: string } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'type') && typeof schema.type === 'string'
}

/** Type guard to check if schema is an object schema */
export const isObjectSchema = (schema: JSONSchema): schema is JSONSchema.Object => {
  return (
    isSchemaObject(schema) &&
    ((Object.hasOwn(schema, 'type') && schema.type === 'object') || Object.hasOwn(schema, 'properties'))
  )
}

/** Type guard to check if schema has properties */
export const hasProperties = (
  schema: JSONSchema,
): schema is SchemaObject & { properties: Record<string, JSONSchema> } => {
  return (
    isSchemaObject(schema) &&
    Object.hasOwn(schema, 'properties') &&
    typeof schema.properties === 'object' &&
    schema.properties !== null
  )
}

/** Type guard to check if schema has enum */
export const hasEnum = (schema: JSONSchema): schema is SchemaObject & { enum: readonly unknown[] } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'enum') && Array.isArray(schema.enum)
}

/** Type guard to check if schema has const */
export const hasConst = (schema: JSONSchema): schema is SchemaObject & { const: unknown } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'const')
}

/** Type guard to check if schema has pattern */
export const hasPattern = (schema: JSONSchema): schema is SchemaObject & { pattern: string } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'pattern') && typeof schema.pattern === 'string'
}

/** Type guard to check if schema has format */
export const hasFormat = (schema: JSONSchema): schema is SchemaObject & { format: string } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'format') && typeof schema.format === 'string'
}

/** Type guard to check if schema has default */
export const hasDefault = (schema: JSONSchema): schema is SchemaObject & { default: unknown } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'default')
}

/** Type guard to check if schema has examples */
export const hasExamples = (schema: JSONSchema): schema is SchemaObject & { examples: readonly unknown[] } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'examples') && Array.isArray(schema.examples)
}

/** Type guard to check if schema has oneOf */
export const hasOneOf = (schema: JSONSchema): schema is SchemaObject & { oneOf: readonly JSONSchema[] } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'oneOf') && Array.isArray(schema.oneOf)
}

/** Type guard to check if schema has anyOf */
export const hasAnyOf = (schema: JSONSchema): schema is SchemaObject & { anyOf: readonly JSONSchema[] } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'anyOf') && Array.isArray(schema.anyOf)
}

/** Type guard to check if schema has allOf */
export const hasAllOf = (schema: JSONSchema): schema is SchemaObject & { allOf: readonly JSONSchema[] } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'allOf') && Array.isArray(schema.allOf)
}

/** Type guard to check if schema has required */
export const hasRequired = (schema: JSONSchema): schema is SchemaObject & { required: readonly string[] } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'required') && Array.isArray(schema.required)
}

/** Type guard to check if schema has items (and it's not just boolean) */
export const hasItems = (schema: JSONSchema): schema is SchemaObject & { items: SchemaObject } => {
  return (
    isSchemaObject(schema) &&
    Object.hasOwn(schema, 'items') &&
    typeof schema.items === 'object' &&
    schema.items !== null &&
    typeof schema.items !== 'boolean'
  )
}

/** Type guard to check if schema has additionalProperties */
export const hasAdditionalProperties = (
  schema: JSONSchema,
): schema is SchemaObject & { additionalProperties: JSONSchema | boolean } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'additionalProperties')
}

/** Type guard to check if schema has minLength */
export const hasMinLength = (schema: JSONSchema): schema is SchemaObject & { minLength: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'minLength') && typeof schema.minLength === 'number'
}

/** Type guard to check if schema has maxLength */
export const hasMaxLength = (schema: JSONSchema): schema is SchemaObject & { maxLength: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'maxLength') && typeof schema.maxLength === 'number'
}

/** Type guard to check if schema has minimum */
export const hasMinimum = (schema: JSONSchema): schema is SchemaObject & { minimum: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'minimum') && typeof schema.minimum === 'number'
}

/** Type guard to check if schema has maximum */
export const hasMaximum = (schema: JSONSchema): schema is SchemaObject & { maximum: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'maximum') && typeof schema.maximum === 'number'
}

/** Type guard to check if schema has exclusiveMinimum */
export const hasExclusiveMinimum = (schema: JSONSchema): schema is SchemaObject & { exclusiveMinimum: number } => {
  return (
    isSchemaObject(schema) && Object.hasOwn(schema, 'exclusiveMinimum') && typeof schema.exclusiveMinimum === 'number'
  )
}

/** Type guard to check if schema has exclusiveMaximum */
export const hasExclusiveMaximum = (schema: JSONSchema): schema is SchemaObject & { exclusiveMaximum: number } => {
  return (
    isSchemaObject(schema) && Object.hasOwn(schema, 'exclusiveMaximum') && typeof schema.exclusiveMaximum === 'number'
  )
}

/**
 * Draft-04 expressed a strict lower bound as a boolean `exclusiveMinimum: true`
 * paired with `minimum`, where draft-06+ uses a standalone numeric keyword. True
 * only for that legacy boolean form, so callers can tighten the `minimum` compare.
 */
export const hasStrictExclusiveMinimum = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  const flag: unknown = schema.exclusiveMinimum
  return flag === true
}

/** Draft-04 boolean `exclusiveMaximum: true` paired with `maximum`. See {@link hasStrictExclusiveMinimum}. */
export const hasStrictExclusiveMaximum = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  const flag: unknown = schema.exclusiveMaximum
  return flag === true
}

/** Type guard to check if schema has multipleOf */
export const hasMultipleOf = (schema: JSONSchema): schema is SchemaObject & { multipleOf: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'multipleOf') && typeof schema.multipleOf === 'number'
}

/** Type guard to check if schema has minItems */
export const hasMinItems = (schema: JSONSchema): schema is SchemaObject & { minItems: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'minItems') && typeof schema.minItems === 'number'
}

/** Type guard to check if schema has maxItems */
export const hasMaxItems = (schema: JSONSchema): schema is SchemaObject & { maxItems: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'maxItems') && typeof schema.maxItems === 'number'
}

/** Type guard to check if schema has uniqueItems */
export const hasUniqueItems = (schema: JSONSchema): schema is SchemaObject & { uniqueItems: boolean } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'uniqueItems') && typeof schema.uniqueItems === 'boolean'
}

/** Type guard to check if schema has minProperties */
export const hasMinProperties = (schema: JSONSchema): schema is SchemaObject & { minProperties: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'minProperties') && typeof schema.minProperties === 'number'
}

/** Type guard to check if schema has maxProperties */
export const hasMaxProperties = (schema: JSONSchema): schema is SchemaObject & { maxProperties: number } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'maxProperties') && typeof schema.maxProperties === 'number'
}

/** Type guard to check if schema has dependentRequired (2020-12). */
export const hasDependentRequired = (
  schema: JSONSchema,
): schema is SchemaObject & { dependentRequired: Record<string, readonly string[]> } => {
  return (
    isSchemaObject(schema) &&
    Object.hasOwn(schema, 'dependentRequired') &&
    typeof schema.dependentRequired === 'object' &&
    schema.dependentRequired !== null
  )
}

/** Type guard to check if schema has a propertyNames subschema. */
export const hasPropertyNames = (schema: JSONSchema): schema is SchemaObject & { propertyNames: JSONSchema } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'propertyNames')
}

/** Type guard to check if schema has dependentSchemas (2020-12). */
export const hasDependentSchemas = (
  schema: JSONSchema,
): schema is SchemaObject & { dependentSchemas: Record<string, JSONSchema> } => {
  return (
    isSchemaObject(schema) &&
    Object.hasOwn(schema, 'dependentSchemas') &&
    typeof schema.dependentSchemas === 'object' &&
    schema.dependentSchemas !== null
  )
}

/** Type guard to check if schema has patternProperties. */
export const hasPatternProperties = (
  schema: JSONSchema,
): schema is SchemaObject & { patternProperties: Record<string, JSONSchema> } => {
  return (
    isSchemaObject(schema) &&
    Object.hasOwn(schema, 'patternProperties') &&
    typeof schema.patternProperties === 'object' &&
    schema.patternProperties !== null
  )
}

/** Type guard to check if schema has a `contains` subschema (array). */
export const hasContains = (schema: JSONSchema): schema is SchemaObject & { contains: JSONSchema } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'contains')
}

/** Type guard to check if schema has a `not` subschema. */
export const hasNot = (schema: JSONSchema): schema is SchemaObject & { not: JSONSchema } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'not')
}

/** Type guard to check if schema has an `if` subschema (with optional then/else). */
export const hasIf = (schema: JSONSchema): schema is SchemaObject & { if: JSONSchema } => {
  return isSchemaObject(schema) && Object.hasOwn(schema, 'if')
}

export { hasRef } from './has-ref'
