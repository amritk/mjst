import { describe, expect, it } from 'vitest'
import { parseSchemaObject } from './schema'

describe('schema', () => {
  it('returns empty object for non-object and non-boolean input', () => {
    expect(parseSchemaObject(null)).toEqual({})
    expect(parseSchemaObject(undefined)).toEqual({})
    expect(parseSchemaObject('schema')).toEqual({})
    expect(parseSchemaObject(123)).toEqual({})
    expect(parseSchemaObject([])).toEqual({})
  })

  it('parses primitive string fields and format', () => {
    const result = parseSchemaObject({
      type: 'string',
      name: 'Pet',
      title: 'Pet title',
      description: 'A pet schema',
      contentMediaType: 'application/json',
      contentEncoding: 'base64',
      pattern: '^[a-z]+$',
      format: 'uuid',
      unknown: 'value',
    })

    expect(result).toEqual({
      type: 'string',
      name: 'Pet',
      title: 'Pet title',
      description: 'A pet schema',
      contentMediaType: 'application/json',
      contentEncoding: 'base64',
      pattern: '^[a-z]+$',
      format: 'uuid',
    })
  })

  it('parses schema type as primitive value', () => {
    const result = parseSchemaObject({
      type: 'object',
    })

    expect(result).toEqual({
      type: 'object',
    })
  })

  it('filters invalid schema types when type is an array', () => {
    const result = parseSchemaObject({
      type: ['string', 'invalid', 'array', 1, null],
    })

    expect(result).toEqual({
      type: ['string', 'array'],
    })
  })

  it('omits type when all array values are invalid', () => {
    const result = parseSchemaObject({
      type: ['invalid', 'also-invalid'],
    })

    expect(result).toEqual({})
  })

  it('preserves default, const, and example values', () => {
    const result = parseSchemaObject({
      default: { enabled: true },
      const: 'fixed',
      example: 42,
    })

    expect(result).toEqual({
      default: { enabled: true },
      const: 'fixed',
      example: 42,
    })
  })

  it('parses enum and examples only when arrays', () => {
    const result = parseSchemaObject({
      enum: ['a', 'b'],
      examples: [1, 2],
      invalidEnum: 'not-an-array',
      invalidExamples: { value: 1 },
    })

    expect(result).toEqual({
      enum: ['a', 'b'],
      examples: [1, 2],
    })
  })

  it('parses boolean, numeric, and integer-constrained fields', () => {
    const result = parseSchemaObject({
      type: ['object', 'array', 'string', 'number'],
      deprecated: true,
      readOnly: false,
      writeOnly: true,
      uniqueItems: true,
      multipleOf: 2,
      maximum: 10,
      exclusiveMaximum: 9,
      minimum: 1,
      exclusiveMinimum: 0,
      maxContains: 4,
      minContains: 1,
      maxLength: 30,
      minLength: 1,
      maxItems: 10,
      minItems: 0,
      maxProperties: 5,
      minProperties: 0,
      notInteger: 1.5,
      negativeInteger: -1,
    })

    expect(result).toEqual({
      type: ['object', 'array', 'string', 'number'],
      deprecated: true,
      readOnly: false,
      writeOnly: true,
      uniqueItems: true,
      multipleOf: 2,
      maximum: 10,
      exclusiveMaximum: 9,
      minimum: 1,
      exclusiveMinimum: 0,
      maxContains: 4,
      minContains: 1,
      maxLength: 30,
      minLength: 1,
      maxItems: 10,
      minItems: 0,
      maxProperties: 5,
      minProperties: 0,
    })
  })

  it('converts OpenAPI 3.0 boolean exclusiveMinimum to numeric value', () => {
    const result = parseSchemaObject({
      type: 'integer',
      minimum: 0,
      exclusiveMinimum: true,
    })

    expect(result).toEqual({
      type: 'integer',
      minimum: 0,
      exclusiveMinimum: 0,
    })
  })

  it('converts OpenAPI 3.0 boolean exclusiveMaximum to numeric value', () => {
    const result = parseSchemaObject({
      type: 'number',
      maximum: 100,
      exclusiveMaximum: true,
    })

    expect(result).toEqual({
      type: 'number',
      maximum: 100,
      exclusiveMaximum: 100,
    })
  })

  it('ignores boolean exclusiveMinimum when minimum is not present', () => {
    const result = parseSchemaObject({
      type: 'integer',
      exclusiveMinimum: true,
    })

    expect(result).toEqual({
      type: 'integer',
    })
  })

  it('ignores boolean exclusiveMaximum when maximum is not present', () => {
    const result = parseSchemaObject({
      type: 'number',
      exclusiveMaximum: true,
    })

    expect(result).toEqual({
      type: 'number',
    })
  })

  it('ignores false value for exclusiveMinimum and exclusiveMaximum', () => {
    const result = parseSchemaObject({
      type: 'number',
      minimum: 0,
      maximum: 100,
      exclusiveMinimum: false,
      exclusiveMaximum: false,
    })

    expect(result).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 100,
    })
  })

  it('filters required to only include string items', () => {
    const result = parseSchemaObject({
      type: 'object',
      required: ['id', 1, true, 'name'],
    })

    expect(result).toEqual({
      type: 'object',
      required: ['id', 'name'],
    })
  })

  it('parses object-only fields and rejects non-plain objects', () => {
    const result = parseSchemaObject({
      discriminator: { propertyName: 'kind' },
      xml: { name: 'item' },
      externalDocs: { url: 'https://example.com' },
      invalidDiscriminator: new Date(),
    })

    expect(result).toEqual({
      discriminator: { propertyName: 'kind' },
      xml: { name: 'item' },
      externalDocs: { url: 'https://example.com' },
    })
  })

  it('parses nested schema fields and $ref objects', () => {
    const result = parseSchemaObject({
      type: ['string', 'object', 'array'],
      contentSchema: { type: 'string' },
      not: { type: 'number' },
      items: { $ref: '#/$defs/schema', '$ref-value': { id: 'schema' }, note: 'keep me' },
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
      contains: { type: 'integer' },
      if: { type: 'object' },
      then: { type: 'array' },
      else: { type: 'null' },
    })

    expect(result).toEqual({
      type: ['string', 'object', 'array'],
      contentSchema: { type: 'string' },
      not: { type: 'number' },
      items: { $ref: '#/$defs/schema', '$ref-value': { id: 'schema' }, note: 'keep me' },
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
      contains: { type: 'integer' },
      if: { type: 'object' },
      then: { type: 'array' },
      else: { type: 'null' },
    })
  })

  it('parses arrays of schemas and filters non-object values', () => {
    const result = parseSchemaObject({
      type: 'array',
      allOf: [{ type: 'string' }, 1, null, { $ref: '#/$defs/value' }],
      oneOf: ['x', { type: 'number' }],
      anyOf: [false, { type: 'integer' }],
      prefixItems: [{ type: 'boolean' }, 'invalid'],
    })

    expect(result).toEqual({
      type: 'array',
      allOf: [{ type: 'string' }, { $ref: '#/$defs/value' }],
      oneOf: [{ type: 'number' }],
      anyOf: [{ type: 'integer' }],
      prefixItems: [{ type: 'boolean' }],
    })
  })

  it('parses schema records and omits invalid record values', () => {
    const result = parseSchemaObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
        owner: { $ref: '#/$defs/user' },
        skip: 'invalid',
      },
      patternProperties: {
        '^x-': { type: 'number' },
        '^y-': 1,
      },
      dependentSchemas: {
        role: { type: 'string' },
        status: null,
      },
      $defs: {
        user: { type: 'object' },
        invalid: 'text',
      },
    })

    expect(result).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        owner: { $ref: '#/$defs/user' },
      },
      patternProperties: {
        '^x-': { type: 'number' },
      },
      dependentSchemas: {
        role: { type: 'string' },
      },
      $defs: {
        user: { type: 'object' },
      },
    })
  })

  it.each([
    {
      name: 'infers object type from valid object keywords',
      input: {
        properties: {
          id: { type: 'string' },
          owner: { $ref: '#/$defs/user' },
        },
        required: ['id', 1, 'owner'],
        additionalProperties: false,
      },
      expected: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          owner: { $ref: '#/$defs/user' },
        },
        required: ['id', 'owner'],
        additionalProperties: false,
      },
    },
    {
      name: 'does not infer object type from invalid object keywords',
      input: {
        properties: 'invalid',
        required: false,
        additionalProperties: Symbol('invalid'),
      },
      expected: {},
    },
    {
      name: 'infers array type from valid array keywords',
      input: {
        items: { type: 'string' },
        minItems: 1,
        uniqueItems: true,
      },
      expected: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        uniqueItems: true,
      },
    },
    {
      name: 'infers string type from string format',
      input: {
        format: 'uuid',
        minLength: 3,
      },
      expected: {
        type: 'string',
        format: 'uuid',
        minLength: 3,
      },
    },
    {
      name: 'infers integer type from integer format',
      input: {
        format: 'int64',
        minimum: 1,
      },
      expected: {
        type: 'integer',
        format: 'int64',
        minimum: 1,
      },
    },
    {
      name: 'infers number type from decimal format',
      input: {
        format: 'decimal',
        minimum: 0.1,
      },
      expected: {
        type: 'number',
        format: 'decimal',
        minimum: 0.1,
      },
    },
    {
      name: 'infers boolean type from const',
      input: {
        const: true,
      },
      expected: {
        type: 'boolean',
        const: true,
      },
    },
    {
      name: 'infers null type from enum values',
      input: {
        enum: [null, null],
      },
      expected: {
        type: 'null',
        enum: [null, null],
      },
    },
    {
      name: 'selects highest score when inferred types compete',
      input: {
        minItems: 1,
        maxItems: 3,
        minLength: 2,
      },
      expected: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
      },
    },
    {
      name: 'ignores invalid keyword values for inference',
      input: {
        minItems: -1,
        maxItems: 'ten',
        uniqueItems: 'yes',
        minLength: -2,
        minimum: 'one',
        properties: null,
      },
      expected: {},
    },
    {
      name: 'prefers object when object and array scores are tied',
      input: {
        minProperties: 1,
        minItems: 1,
      },
      expected: {
        type: 'object',
        minProperties: 1,
      },
    },
    {
      name: 'prefers integer when number and integer scores are tied',
      input: {
        minimum: 1,
      },
      expected: {
        type: 'integer',
        minimum: 1,
      },
    },
    {
      name: 'prefers string format over competing keyword scores',
      input: {
        format: 'email',
        minItems: 1,
        maxItems: 2,
        minLength: 3,
      },
      expected: {
        type: 'string',
        format: 'email',
        minLength: 3,
      },
    },
    {
      name: 'prefers const-based boolean over enum percentages',
      input: {
        const: false,
        enum: [null, null, false],
      },
      expected: {
        type: 'boolean',
        const: false,
        enum: [null, null, false],
      },
    },
  ])('$name', ({ input, expected }) => {
    expect(parseSchemaObject(input)).toEqual(expected)
  })

  it('supports boolean and schema values for additional and unevaluated properties', () => {
    const result = parseSchemaObject({
      type: ['object', 'array'],
      additionalProperties: { type: 'string' },
      unevaluatedItems: false,
      unevaluatedProperties: { $ref: '#/$defs/value' },
    })

    expect(result).toEqual({
      type: ['object', 'array'],
      additionalProperties: { type: 'string' },
      unevaluatedItems: false,
      unevaluatedProperties: { $ref: '#/$defs/value' },
    })
  })

  it('keeps only keywords that match the declared schema type', () => {
    const result = parseSchemaObject({
      type: 'number',
      minimum: 1,
      maxLength: 20,
      properties: {
        id: { type: 'string' },
      },
      items: { type: 'string' },
    })

    expect(result).toEqual({
      type: 'number',
      minimum: 1,
    })
  })

  it('drops array-only keywords when schema type is object', () => {
    const result = parseSchemaObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      items: { type: 'string' },
      prefixItems: [{ type: 'number' }],
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      contains: { type: 'string' },
    })

    expect(result).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    })
  })

  it('preserves vendor extension keys only', () => {
    const result = parseSchemaObject({
      'x-internal': { enabled: true },
      'x-version': 2,
      internal: 'not-preserved',
    })

    expect(result).toEqual({
      'x-internal': { enabled: true },
      'x-version': 2,
    })
  })
})
