import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDefault,
  hasDependentRequired,
  hasEnum,
  hasExamples,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasFormat,
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
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isObjectSchema,
  isSchemaObject,
} from './schema-guards'

describe('schema-guards', () => {
  // isSchemaObject
  it('isSchemaObject returns true for plain object', () => {
    expect(isSchemaObject({})).toBe(true)
  })

  it('isSchemaObject returns true for object with properties', () => {
    expect(isSchemaObject({ type: 'string' })).toBe(true)
  })

  it('isSchemaObject returns false for boolean true', () => {
    expect(isSchemaObject(true)).toBe(false)
  })

  it('isSchemaObject returns false for boolean false', () => {
    expect(isSchemaObject(false)).toBe(false)
  })

  // hasType
  it('hasType returns true when type is a string', () => {
    expect(hasType({ type: 'string' })).toBe(true)
  })

  it('hasType returns false when type is missing', () => {
    expect(hasType({})).toBe(false)
  })

  it('hasType returns false for boolean schema', () => {
    expect(hasType(true)).toBe(false)
  })

  it('hasType returns false when type is an array', () => {
    expect(hasType({ type: ['string', 'number'] })).toBe(false)
  })

  // isObjectSchema
  it('isObjectSchema returns true for schema with type object', () => {
    expect(isObjectSchema({ type: 'object' })).toBe(true)
  })

  it('isObjectSchema returns true for schema with properties but no type', () => {
    expect(isObjectSchema({ properties: { name: { type: 'string' } } })).toBe(true)
  })

  it('isObjectSchema returns false for string type', () => {
    expect(isObjectSchema({ type: 'string' })).toBe(false)
  })

  it('isObjectSchema returns false for boolean schema', () => {
    expect(isObjectSchema(true)).toBe(false)
  })

  // hasProperties
  it('hasProperties returns true when properties is an object', () => {
    expect(hasProperties({ properties: { name: { type: 'string' } } })).toBe(true)
  })

  it('hasProperties returns true for empty properties object', () => {
    expect(hasProperties({ properties: {} })).toBe(true)
  })

  it('hasProperties returns false when properties is missing', () => {
    expect(hasProperties({ type: 'object' })).toBe(false)
  })

  it('hasProperties returns false for boolean schema', () => {
    expect(hasProperties(true)).toBe(false)
  })

  // hasEnum
  it('hasEnum returns true when enum is an array', () => {
    expect(hasEnum({ enum: ['a', 'b'] })).toBe(true)
  })

  it('hasEnum returns true for empty enum array', () => {
    expect(hasEnum({ enum: [] })).toBe(true)
  })

  it('hasEnum returns false when enum is missing', () => {
    expect(hasEnum({})).toBe(false)
  })

  it('hasEnum returns false for boolean schema', () => {
    expect(hasEnum(false)).toBe(false)
  })

  // hasConst
  it('hasConst returns true when const is present', () => {
    expect(hasConst({ const: 'value' })).toBe(true)
  })

  it('hasConst returns true for null const', () => {
    expect(hasConst({ const: null })).toBe(true)
  })

  it('hasConst returns false when const is missing', () => {
    expect(hasConst({})).toBe(false)
  })

  // hasPattern
  it('hasPattern returns true when pattern is a string', () => {
    expect(hasPattern({ pattern: '^[a-z]+$' })).toBe(true)
  })

  it('hasPattern returns false when pattern is not a string', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasPattern({ pattern: 123 } as unknown as JSONSchema)).toBe(false)
  })

  it('hasPattern returns false when pattern is missing', () => {
    expect(hasPattern({})).toBe(false)
  })

  // hasFormat
  it('hasFormat returns true when format is a string', () => {
    expect(hasFormat({ format: 'date-time' })).toBe(true)
  })

  it('hasFormat returns false when format is missing', () => {
    expect(hasFormat({})).toBe(false)
  })

  it('hasFormat returns false when format is not a string', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasFormat({ format: 123 } as unknown as JSONSchema)).toBe(false)
  })

  // hasDefault
  it('hasDefault returns true when default is present', () => {
    expect(hasDefault({ default: 'value' })).toBe(true)
  })

  it('hasDefault returns true for undefined-like defaults', () => {
    expect(hasDefault({ default: null })).toBe(true)
  })

  it('hasDefault returns false when default is missing', () => {
    expect(hasDefault({})).toBe(false)
  })

  // hasExamples
  it('hasExamples returns true when examples is an array', () => {
    expect(hasExamples({ examples: ['foo'] })).toBe(true)
  })

  it('hasExamples returns true for empty examples array', () => {
    expect(hasExamples({ examples: [] })).toBe(true)
  })

  it('hasExamples returns false when examples is missing', () => {
    expect(hasExamples({})).toBe(false)
  })

  it('hasExamples returns false when examples is not an array', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasExamples({ examples: 'not-array' } as unknown as JSONSchema)).toBe(false)
  })

  // hasOneOf
  it('hasOneOf returns true when oneOf is an array', () => {
    expect(hasOneOf({ oneOf: [{ type: 'string' }] })).toBe(true)
  })

  it('hasOneOf returns false when oneOf is missing', () => {
    expect(hasOneOf({})).toBe(false)
  })

  // hasAnyOf
  it('hasAnyOf returns true when anyOf is an array', () => {
    expect(hasAnyOf({ anyOf: [{ type: 'string' }] })).toBe(true)
  })

  it('hasAnyOf returns false when anyOf is missing', () => {
    expect(hasAnyOf({})).toBe(false)
  })

  // hasAllOf
  it('hasAllOf returns true when allOf is an array', () => {
    expect(hasAllOf({ allOf: [{ type: 'string' }] })).toBe(true)
  })

  it('hasAllOf returns false when allOf is missing', () => {
    expect(hasAllOf({})).toBe(false)
  })

  // hasRequired
  it('hasRequired returns true when required is an array', () => {
    expect(hasRequired({ required: ['name'] })).toBe(true)
  })

  it('hasRequired returns true for empty required array', () => {
    expect(hasRequired({ required: [] })).toBe(true)
  })

  it('hasRequired returns false when required is missing', () => {
    expect(hasRequired({})).toBe(false)
  })

  // hasItems
  it('hasItems returns true when items is a schema object', () => {
    expect(hasItems({ items: { type: 'string' } })).toBe(true)
  })

  it('hasItems returns false when items is boolean true', () => {
    expect(hasItems({ items: true })).toBe(false)
  })

  it('hasItems returns false when items is missing', () => {
    expect(hasItems({})).toBe(false)
  })

  // hasAdditionalProperties
  it('hasAdditionalProperties returns true when additionalProperties is present', () => {
    expect(hasAdditionalProperties({ additionalProperties: false })).toBe(true)
  })

  it('hasAdditionalProperties returns true for schema additionalProperties', () => {
    expect(hasAdditionalProperties({ additionalProperties: { type: 'string' } })).toBe(true)
  })

  it('hasAdditionalProperties returns false when missing', () => {
    expect(hasAdditionalProperties({})).toBe(false)
  })

  // hasMinLength
  it('hasMinLength returns true when minLength is a number', () => {
    expect(hasMinLength({ minLength: 1 })).toBe(true)
  })

  it('hasMinLength returns false when minLength is not a number', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasMinLength({ minLength: '1' } as unknown as JSONSchema)).toBe(false)
  })

  it('hasMinLength returns false when missing', () => {
    expect(hasMinLength({})).toBe(false)
  })

  // hasMaxLength
  it('hasMaxLength returns true when maxLength is a number', () => {
    expect(hasMaxLength({ maxLength: 100 })).toBe(true)
  })

  it('hasMaxLength returns false when missing', () => {
    expect(hasMaxLength({})).toBe(false)
  })

  // hasMinimum
  it('hasMinimum returns true when minimum is a number', () => {
    expect(hasMinimum({ minimum: 0 })).toBe(true)
  })

  it('hasMinimum returns false when missing', () => {
    expect(hasMinimum({})).toBe(false)
  })

  // hasMaximum
  it('hasMaximum returns true when maximum is a number', () => {
    expect(hasMaximum({ maximum: 100 })).toBe(true)
  })

  it('hasMaximum returns false when missing', () => {
    expect(hasMaximum({})).toBe(false)
  })

  // hasExclusiveMinimum
  it('hasExclusiveMinimum returns true when exclusiveMinimum is a number', () => {
    expect(hasExclusiveMinimum({ exclusiveMinimum: 0 })).toBe(true)
  })

  it('hasExclusiveMinimum returns false for boolean exclusiveMinimum', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasExclusiveMinimum({ exclusiveMinimum: true } as unknown as JSONSchema)).toBe(false)
  })

  it('hasExclusiveMinimum returns false when missing', () => {
    expect(hasExclusiveMinimum({})).toBe(false)
  })

  // hasExclusiveMaximum
  it('hasExclusiveMaximum returns true when exclusiveMaximum is a number', () => {
    expect(hasExclusiveMaximum({ exclusiveMaximum: 100 })).toBe(true)
  })

  it('hasExclusiveMaximum returns false for boolean exclusiveMaximum', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasExclusiveMaximum({ exclusiveMaximum: false } as unknown as JSONSchema)).toBe(false)
  })

  it('hasExclusiveMaximum returns false when missing', () => {
    expect(hasExclusiveMaximum({})).toBe(false)
  })

  // hasMultipleOf
  it('hasMultipleOf returns true when multipleOf is a number', () => {
    expect(hasMultipleOf({ multipleOf: 5 })).toBe(true)
  })

  it('hasMultipleOf returns false when missing', () => {
    expect(hasMultipleOf({})).toBe(false)
  })

  // hasMinItems
  it('hasMinItems returns true when minItems is a number', () => {
    expect(hasMinItems({ minItems: 1 })).toBe(true)
  })

  it('hasMinItems returns false when missing', () => {
    expect(hasMinItems({})).toBe(false)
  })

  // hasMaxItems
  it('hasMaxItems returns true when maxItems is a number', () => {
    expect(hasMaxItems({ maxItems: 10 })).toBe(true)
  })

  it('hasMaxItems returns false when missing', () => {
    expect(hasMaxItems({})).toBe(false)
  })

  // hasUniqueItems
  it('hasUniqueItems returns true when uniqueItems is a boolean', () => {
    expect(hasUniqueItems({ uniqueItems: true })).toBe(true)
    expect(hasUniqueItems({ uniqueItems: false })).toBe(true)
  })

  it('hasUniqueItems returns false when missing', () => {
    expect(hasUniqueItems({})).toBe(false)
  })

  // hasMinProperties
  it('hasMinProperties returns true when minProperties is a number', () => {
    expect(hasMinProperties({ minProperties: 1 })).toBe(true)
  })

  it('hasMinProperties returns false when missing', () => {
    expect(hasMinProperties({})).toBe(false)
  })

  it('hasMinProperties returns false for non-number value', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasMinProperties({ minProperties: '1' } as unknown as JSONSchema)).toBe(false)
  })

  // hasMaxProperties
  it('hasMaxProperties returns true when maxProperties is a number', () => {
    expect(hasMaxProperties({ maxProperties: 10 })).toBe(true)
  })

  it('hasMaxProperties returns false when missing', () => {
    expect(hasMaxProperties({})).toBe(false)
  })

  // hasDependentRequired
  it('hasDependentRequired returns true for an object value', () => {
    expect(hasDependentRequired({ dependentRequired: { a: ['b'] } })).toBe(true)
  })

  it('hasDependentRequired returns false when missing or non-object', () => {
    expect(hasDependentRequired({})).toBe(false)
    expect(hasDependentRequired({ dependentRequired: null } as unknown as JSONSchema)).toBe(false)
  })

  // hasPropertyNames
  it('hasPropertyNames returns true when the keyword is present', () => {
    expect(hasPropertyNames({ propertyNames: { pattern: '^[a-z]+$' } })).toBe(true)
  })

  it('hasPropertyNames returns false when missing', () => {
    expect(hasPropertyNames({})).toBe(false)
  })

  // hasRef
  it('hasRef returns true when $ref is a string', () => {
    expect(hasRef({ $ref: '#/$defs/user' })).toBe(true)
  })

  it('hasRef returns false when $ref is missing', () => {
    expect(hasRef({})).toBe(false)
  })

  it('hasRef returns false for boolean schema', () => {
    expect(hasRef(true)).toBe(false)
  })

  it('hasRef returns false when $ref is not a string', () => {
    // Intentionally passing wrong type to verify the guard rejects it
    expect(hasRef({ $ref: 123 } as unknown as JSONSchema)).toBe(false)
  })
})
