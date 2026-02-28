import { describe, expect, it } from 'vitest'
import { generateValidationExpression } from './generate-validation-expression'

describe('generate-validation-expression', () => {
  it('returns accessor with nullish coalescing for non-schema objects when required', () => {
    const result = generateValidationExpression('name', true, '""', true)
    expect(result).toBe('input?.name ?? ""')
  })

  it('returns accessor without default for non-schema objects when optional', () => {
    const result = generateValidationExpression('name', true, '""', false)
    expect(result).toBe('input?.name')
  })

  it('generates string type validation', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true)

    expect(result).toContain('typeof input?.name === "string"')
    expect(result).toContain('String(input?.name)')
  })

  it('generates string validation with pattern', () => {
    const schema = { type: 'string' as const, pattern: '^[A-Z]' }
    const result = generateValidationExpression('code', schema, '""', true)

    expect(result).toContain('typeof input?.code === "string"')
    expect(result).toContain('/^[A-Z]/.test(input?.code)')
  })

  it('generates string validation with minLength', () => {
    const schema = { type: 'string' as const, minLength: 5 }
    const result = generateValidationExpression('name', schema, '""', true)

    expect(result).toContain('typeof input?.name === "string"')
    expect(result).toContain('input?.name.length >= 5')
  })

  it('generates string validation with maxLength', () => {
    const schema = { type: 'string' as const, maxLength: 100 }
    const result = generateValidationExpression('name', schema, '""', true)

    expect(result).toContain('typeof input?.name === "string"')
    expect(result).toContain('input?.name.length <= 100')
  })

  it('generates string validation with minLength and maxLength', () => {
    const schema = { type: 'string' as const, minLength: 5, maxLength: 100 }
    const result = generateValidationExpression('name', schema, '""', true)

    expect(result).toContain('input?.name.length >= 5')
    expect(result).toContain('input?.name.length <= 100')
  })

  it('generates number type validation', () => {
    const schema = { type: 'number' as const }
    const result = generateValidationExpression('age', schema, '0', true)

    expect(result).toContain('typeof input?.age === "number"')
    expect(result).toContain('Number(input?.age)')
  })

  it('generates number validation with minimum', () => {
    const schema = { type: 'number' as const, minimum: 0 }
    const result = generateValidationExpression('age', schema, '0', true)

    expect(result).toContain('typeof input?.age === "number"')
    expect(result).toContain('input?.age >= 0')
  })

  it('generates number validation with maximum', () => {
    const schema = { type: 'number' as const, maximum: 100 }
    const result = generateValidationExpression('score', schema, '0', true)

    expect(result).toContain('typeof input?.score === "number"')
    expect(result).toContain('input?.score <= 100')
  })

  it('generates number validation with exclusiveMinimum', () => {
    const schema = { type: 'number' as const, exclusiveMinimum: 0 }
    const result = generateValidationExpression('price', schema, '0', true)

    expect(result).toContain('typeof input?.price === "number"')
    expect(result).toContain('input?.price > 0')
  })

  it('generates number validation with exclusiveMaximum', () => {
    const schema = { type: 'number' as const, exclusiveMaximum: 100 }
    const result = generateValidationExpression('percentage', schema, '0', true)

    expect(result).toContain('typeof input?.percentage === "number"')
    expect(result).toContain('input?.percentage < 100')
  })

  it('generates number validation with multipleOf', () => {
    const schema = { type: 'number' as const, multipleOf: 5 }
    const result = generateValidationExpression('quantity', schema, '0', true)

    expect(result).toContain('typeof input?.quantity === "number"')
    expect(result).toContain('input?.quantity % 5 === 0')
  })

  it('generates integer type validation', () => {
    const schema = { type: 'integer' as const }
    const result = generateValidationExpression('count', schema, '0', true)

    expect(result).toContain('typeof input?.count === "number"')
    expect(result).toContain('Number(input?.count)')
  })

  it('generates boolean type validation', () => {
    const schema = { type: 'boolean' as const }
    const result = generateValidationExpression('isActive', schema, 'false', true)

    expect(result).toContain('typeof input?.isActive === "boolean"')
    expect(result).toContain('Boolean(input?.isActive)')
  })

  it('generates array type validation', () => {
    const schema = { type: 'array' as const }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags)')
    expect(result).toContain('Array.isArray(input?.tags) ? input?.tags : []')
  })

  it('generates array validation with minItems', () => {
    const schema = { type: 'array' as const, minItems: 1 }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags)')
    expect(result).toContain('input?.tags.length >= 1')
  })

  it('generates array validation with maxItems', () => {
    const schema = { type: 'array' as const, maxItems: 10 }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags)')
    expect(result).toContain('input?.tags.length <= 10')
  })

  it('generates array validation with uniqueItems', () => {
    const schema = { type: 'array' as const, uniqueItems: true }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags)')
    expect(result).toContain('new Set(input?.tags).size === input?.tags.length')
  })

  it('generates object type validation', () => {
    const schema = { type: 'object' as const }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('isObject(input?.user)')
  })

  it('generates object validation with required properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'number' as const },
        name: { type: 'string' as const },
      },
      required: ['id', 'name'],
    }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('"id" in input?.user')
    expect(result).toContain('"name" in input?.user')
  })

  it('generates object validation with minProperties', () => {
    const schema = { type: 'object' as const, minProperties: 2 }
    const result = generateValidationExpression('data', schema, '{}', true)

    expect(result).toContain('Object.keys(input?.data).length >= 2')
  })

  it('generates object validation with maxProperties', () => {
    const schema = { type: 'object' as const, maxProperties: 5 }
    const result = generateValidationExpression('data', schema, '{}', true)

    expect(result).toContain('Object.keys(input?.data).length <= 5')
  })

  it('generates object validation with additionalProperties false', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'number' as const },
        name: { type: 'string' as const },
      },
      additionalProperties: false,
    }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('Object.keys(input?.user).every(k => ["id","name"].includes(k))')
  })

  it('generates enum validation', () => {
    const schema = { enum: ['red', 'green', 'blue'] }
    const result = generateValidationExpression('color', schema, '"red"', true)

    expect(result).toContain('["red","green","blue"].includes(input?.color)')
  })

  it('generates enum validation with type', () => {
    const schema = { type: 'string' as const, enum: ['active', 'inactive'] }
    const result = generateValidationExpression('status', schema, '"active"', true)

    expect(result).toContain('typeof input?.status === "string"')
    expect(result).toContain('["active","inactive"].includes(input?.status)')
  })

  it('handles $ref resolution', () => {
    const rootSchema = {
      $defs: {
        Address: {
          type: 'object' as const,
          properties: {
            street: { type: 'string' as const },
            city: { type: 'string' as const },
          },
        },
      },
    }
    const schema = { $ref: '#/$defs/Address' }
    const result = generateValidationExpression('address', schema, '{}', true, rootSchema)

    expect(result).toContain('typeof input?.address === "object"')
    expect(result).toContain('input?.address !== null')
  })

  it('handles circular $ref by breaking cycle', () => {
    const rootSchema = {
      $defs: {
        Node: {
          type: 'object' as const,
          properties: {
            value: { type: 'string' as const },
            next: { $ref: '#/$defs/Node' },
          },
        },
      },
    }
    const schema = { $ref: '#/$defs/Node' }
    const visitedRefs = new Set(['#/$defs/Node'])
    const result = generateValidationExpression('node', schema, '{}', true, rootSchema, visitedRefs)

    expect(result).toBe('input?.node ?? {}')
  })

  it('handles unresolvable $ref', () => {
    const rootSchema = {}
    const schema = { $ref: '#/$defs/NonExistent' }
    const result = generateValidationExpression('data', schema, '{}', true, rootSchema)

    expect(result).toBe('input?.data ?? {}')
  })

  it('generates oneOf validation without discriminator', () => {
    const schema = {
      oneOf: [{ type: 'string' as const }, { type: 'number' as const }],
    }
    const result = generateValidationExpression('value', schema, '""', true)

    expect(result).toContain('typeof input?.value === "string"')
    expect(result).toContain('typeof input?.value === "number"')
  })

  it('generates oneOf validation with discriminator', () => {
    const schema = {
      oneOf: [
        {
          type: 'object' as const,
          properties: {
            type: { const: 'circle' },
            radius: { type: 'number' as const },
          },
        },
        {
          type: 'object' as const,
          properties: {
            type: { const: 'square' },
            side: { type: 'number' as const },
          },
        },
      ],
    }
    const result = generateValidationExpression('shape', schema, '{}', true)

    expect(result).toContain('input?.shape?.type')
  })

  it('generates anyOf validation without discriminator', () => {
    const schema = {
      anyOf: [{ type: 'string' as const }, { type: 'number' as const }],
    }
    const result = generateValidationExpression('value', schema, '""', true)

    expect(result).toContain('typeof input?.value === "string"')
    expect(result).toContain('typeof input?.value === "number"')
  })

  it('generates anyOf validation with discriminator', () => {
    const schema = {
      anyOf: [
        {
          type: 'object' as const,
          properties: {
            kind: { const: 'A' },
            valueA: { type: 'string' as const },
          },
        },
        {
          type: 'object' as const,
          properties: {
            kind: { const: 'B' },
            valueB: { type: 'number' as const },
          },
        },
      ],
    }
    const result = generateValidationExpression('data', schema, '{}', true)

    expect(result).toContain('input?.data?.kind')
  })

  it('generates allOf validation', () => {
    const schema = {
      allOf: [{ type: 'object' as const }, { properties: { id: { type: 'number' as const } } }],
    }
    const result = generateValidationExpression('entity', schema, '{}', true)

    expect(result).toContain('typeof input?.entity === "object"')
    expect(result).toContain('input?.entity !== null')
  })

  it('generates not validation', () => {
    const schema = {
      not: { type: 'string' as const },
    }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toContain('!(typeof input?.value === "string")')
  })

  it('handles schema without type or enum for required field', () => {
    const schema = { description: 'Any value' }
    const result = generateValidationExpression('data', schema, 'null', true)

    expect(result).toBe('input?.data ?? null')
  })

  it('handles schema without type or enum for optional field', () => {
    const schema = { description: 'Any value' }
    const result = generateValidationExpression('data', schema, 'null', false)

    expect(result).toBe('input?.data ?? null')
  })

  it('returns default value for required field when validation fails', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true)

    expect(result).toContain('? input?.name')
    expect(result).toContain(': ""')
  })

  it('returns undefined for optional field when validation fails', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', false)

    expect(result).toContain('? input?.name')
    expect(result).toContain(': undefined')
  })

  it('includes type coercion for required string field', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true)

    expect(result).toContain('String(input?.name)')
  })

  it('includes type coercion for required number field', () => {
    const schema = { type: 'number' as const }
    const result = generateValidationExpression('age', schema, '0', true)

    expect(result).toContain('Number(input?.age)')
  })

  it('includes type coercion for required boolean field', () => {
    const schema = { type: 'boolean' as const }
    const result = generateValidationExpression('isActive', schema, 'false', true)

    expect(result).toContain('Boolean(input?.isActive)')
  })

  it('includes type coercion for required array field', () => {
    const schema = { type: 'array' as const }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags) ? input?.tags : []')
  })

  it('includes type coercion for required object field', () => {
    const schema = { type: 'object' as const }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('typeof input?.user === "object" && input?.user !== null ? input?.user : {}')
  })

  it('includes type coercion for optional string field', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', false)

    expect(result).toContain('String(input?.name)')
  })

  it('includes type coercion for optional number field', () => {
    const schema = { type: 'number' as const }
    const result = generateValidationExpression('age', schema, '0', false)

    expect(result).toContain('Number(input?.age)')
  })

  it('handles empty oneOf array', () => {
    const schema = { oneOf: [] }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toBe('input?.value ?? null')
  })

  it('handles empty anyOf array', () => {
    const schema = { anyOf: [] }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toBe('input?.value ?? null')
  })

  it('handles empty allOf array', () => {
    const schema = { allOf: [] }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toBe('input?.value ?? null')
  })

  it('handles empty enum array', () => {
    const schema = { enum: [] }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toBe('input?.value ?? null')
  })

  it('combines multiple string constraints', () => {
    const schema = {
      type: 'string' as const,
      pattern: '^[A-Z]',
      minLength: 3,
      maxLength: 10,
    }
    const result = generateValidationExpression('code', schema, '""', true)

    expect(result).toContain('typeof input?.code === "string"')
    expect(result).toContain('/^[A-Z]/.test(input?.code)')
    expect(result).toContain('input?.code.length >= 3')
    expect(result).toContain('input?.code.length <= 10')
  })

  it('combines multiple number constraints', () => {
    const schema = {
      type: 'number' as const,
      minimum: 0,
      maximum: 100,
      multipleOf: 5,
    }
    const result = generateValidationExpression('score', schema, '0', true)

    expect(result).toContain('typeof input?.score === "number"')
    expect(result).toContain('input?.score >= 0')
    expect(result).toContain('input?.score <= 100')
    expect(result).toContain('input?.score % 5 === 0')
  })

  it('combines multiple array constraints', () => {
    const schema = {
      type: 'array' as const,
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
    }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags)')
    expect(result).toContain('input?.tags.length >= 1')
    expect(result).toContain('input?.tags.length <= 10')
    expect(result).toContain('new Set(input?.tags).size === input?.tags.length')
  })

  it('combines multiple object constraints', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'number' as const },
        name: { type: 'string' as const },
      },
      required: ['id'],
      minProperties: 1,
      maxProperties: 5,
      additionalProperties: false,
    }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('typeof input?.user === "object"')
    expect(result).toContain('"id" in input?.user')
    expect(result).toContain('Object.keys(input?.user).length >= 1')
    expect(result).toContain('Object.keys(input?.user).length <= 5')
    expect(result).toContain('Object.keys(input?.user).every(k => ["id","name"].includes(k))')
  })

  it('handles object without properties but with additionalProperties false', () => {
    const schema = {
      type: 'object' as const,
      additionalProperties: false,
    }
    const result = generateValidationExpression('data', schema, '{}', true)

    expect(result).toContain('typeof input?.data === "object"')
    expect(result).not.toContain('every')
  })

  it('handles uniqueItems set to false', () => {
    const schema = {
      type: 'array' as const,
      uniqueItems: false,
    }
    const result = generateValidationExpression('tags', schema, '[]', true)

    expect(result).toContain('Array.isArray(input?.tags)')
    expect(result).not.toContain('new Set')
  })

  it('handles complex nested validation with allOf', () => {
    const schema = {
      allOf: [
        { type: 'object' as const },
        {
          properties: {
            id: { type: 'number' as const, minimum: 1 },
            name: { type: 'string' as const, minLength: 1 },
          },
        },
      ],
    }
    const result = generateValidationExpression('entity', schema, '{}', true)

    expect(result).toContain('typeof input?.entity === "object"')
  })

  it('handles not with complex schema', () => {
    const schema = {
      not: {
        type: 'object' as const,
        properties: {
          banned: { const: true },
        },
      },
    }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('!(typeof input?.user === "object"')
  })

  it('handles $ref without rootSchema', () => {
    const schema = { $ref: '#/$defs/Something' }
    const result = generateValidationExpression('data', schema, '{}', true)

    expect(result).toBe('input?.data ?? {}')
  })

  it('generates validation for integer with all numeric constraints', () => {
    const schema = {
      type: 'integer' as const,
      minimum: 10,
      maximum: 100,
      exclusiveMinimum: 5,
      exclusiveMaximum: 105,
      multipleOf: 10,
    }
    const result = generateValidationExpression('count', schema, '0', true)

    expect(result).toContain('typeof input?.count === "number"')
    expect(result).toContain('input?.count >= 10')
    expect(result).toContain('input?.count <= 100')
    expect(result).toContain('input?.count > 5')
    expect(result).toContain('input?.count < 105')
    expect(result).toContain('input?.count % 10 === 0')
  })

  it('handles empty required array', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'number' as const },
      },
      required: [],
    }
    const result = generateValidationExpression('user', schema, '{}', true)

    expect(result).toContain('typeof input?.user === "object"')
    expect(result).not.toContain('" in input?.user')
  })

  it('uses bracket notation for hyphenated property keys', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('x-linkedin', schema, '""', true)

    expect(result).toContain("input?.['x-linkedin']")
    expect(result).not.toContain('input?.x-linkedin')
  })

  it('removes redundant undefined check when knownNotUndefined is true for required field', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true, undefined, undefined, undefined, true)

    // Should not have nested undefined check
    expect(result).not.toContain('!== undefined ? String')
    // Should have direct coercion
    expect(result).toContain('String(input?.name)')
  })

  it('removes redundant undefined check when knownNotUndefined is true for optional field', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', false, undefined, undefined, undefined, true)

    // Should not have nested undefined check
    expect(result).not.toContain('!== undefined ? String')
    // Should have direct coercion
    expect(result).toContain('String(input?.name)')
  })

  it('keeps undefined check when knownNotUndefined is false for required field', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true, undefined, undefined, undefined, false)

    // Should have nested undefined check
    expect(result).toContain('!== undefined ? String')
  })

  it('removes redundant check for number coercion when knownNotUndefined is true', () => {
    const schema = { type: 'number' as const }
    const result = generateValidationExpression('age', schema, '0', true, undefined, undefined, undefined, true)

    // Should not have nested undefined check
    expect(result).not.toContain('!== undefined ? Number')
    // Should have direct coercion
    expect(result).toContain('Number(input?.age)')
  })

  it('removes redundant check for boolean coercion when knownNotUndefined is true', () => {
    const schema = { type: 'boolean' as const }
    const result = generateValidationExpression('isActive', schema, 'false', true, undefined, undefined, undefined, true)

    // Should not have nested undefined check
    expect(result).not.toContain('!== undefined ? Boolean')
    // Should have direct coercion
    expect(result).toContain('Boolean(input?.isActive)')
  })

  it('removes redundant check for array coercion when knownNotUndefined is true', () => {
    const schema = { type: 'array' as const }
    const result = generateValidationExpression('tags', schema, '[]', true, undefined, undefined, undefined, true)

    // Should still have the array check but not nested undefined
    expect(result).toContain('Array.isArray(input?.tags) ? input?.tags : []')
  })

  it('removes redundant check for object coercion when knownNotUndefined is true', () => {
    const schema = { type: 'object' as const }
    const result = generateValidationExpression('user', schema, '{}', true, undefined, undefined, undefined, true)

    // Should have object check but not nested undefined
    expect(result).toContain('typeof input?.user === "object" && input?.user !== null ? input?.user : {}')
  })

  it('uses accessor override when provided', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true, undefined, undefined, '_name')

    // Should use the provided accessor instead of input?.name
    expect(result).toContain('typeof _name === "string"')
    expect(result).toContain('String(_name)')
    expect(result).not.toContain('input?.name')
  })

  it('combines accessor override with knownNotUndefined optimization', () => {
    const schema = { type: 'string' as const }
    const result = generateValidationExpression('name', schema, '""', true, undefined, undefined, '_name', true)

    // Should use cached variable and skip redundant check
    expect(result).toContain('typeof _name === "string"')
    expect(result).toContain('String(_name)')
    expect(result).not.toContain('!== undefined ? String')
    expect(result).not.toContain('input?.name')
  })

  it('combines multiple allOf sub-schema checks with &&', () => {
    // Each sub-schema independently produces a type check, so allChecks has 2 items
    // and the loop body that appends ' && check[i]' (line 128) is exercised.
    const schema = { allOf: [{ type: 'string' as const }, { type: 'number' as const }] }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toContain('typeof input?.value === "string"')
    expect(result).toContain('&&')
    expect(result).toContain('typeof input?.value === "number"')
  })

  it('falls back to nullish coalescing when allOf sub-schemas produce no checks', () => {
    // Empty sub-schemas produce no checks so allChecks.length === 0 (line 132)
    const schema = { allOf: [{}, {}] }
    const result = generateValidationExpression('value', schema, '"default"', true)

    expect(result).toBe('input?.value ?? "default"')
  })

  it('combines multiple not-schema checks with && inside negation', () => {
    // A not schema with two checks causes the not-loop body (line 141) to run
    const schema = { not: { type: 'string' as const, minLength: 1 } }
    const result = generateValidationExpression('value', schema, 'null', true)

    expect(result).toContain('!(')
    expect(result).toContain('typeof input?.value === "string"')
    expect(result).toContain('&&')
    expect(result).toContain('input?.value.length >= 1')
  })

  it('returns conditional undefined for optional enum-only field without type coercion', () => {
    // An enum schema with no type and no coercion hits the final optional branch (line 270)
    const schema = { enum: ['active', 'inactive'] }
    const result = generateValidationExpression('status', schema, 'undefined', false)

    expect(result).toContain('? input?.status : undefined')
  })
})
