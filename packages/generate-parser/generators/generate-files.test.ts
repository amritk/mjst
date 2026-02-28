import { describe, expect, it } from 'vitest'
import { generateFile } from './generate-files'

describe('generate-files', () => {
  it('generates combined import for $ref property', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const result = generateFile(schema, 'Document')

    expect(result).toContain("import { type ContactObject, parseContactObject } from './contact';")
  })

  it('calls imported parser for optional $ref property', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const result = generateFile(schema, 'Document')

    // With local variable caching, optional $ref properties use the cached variable
    expect(result).toContain('_contact !== undefined && { contact: parseContactObject(_contact) }')
  })

  it('calls imported parser for required $ref property', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      required: ['contact'],
    }

    const result = generateFile(schema, 'Document')

    // With local variable caching, required $ref properties use the cached variable
    expect(result).toContain('contact: parseContactObject(_contact),')
  })

  it('generates combined imports for multiple $ref properties', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const result = generateFile(schema, 'Document')

    expect(result).toContain("import { type ContactObject, parseContactObject } from './contact';")
    expect(result).toContain("import { type ServerObject, parseServerObject } from './server';")
  })

  it('generates correct parser name for multi-word $ref', () => {
    const schema = {
      type: 'object',
      properties: {
        externalDoc: { $ref: '#/$defs/external-documentation' },
      },
    }

    const result = generateFile(schema, 'Document')

    expect(result).toContain(
      "import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';",
    )
    expect(result).toContain('parseExternalDocumentationObject(_externalDoc)')
  })

  it('does not generate ref imports when no $ref properties exist', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }

    const result = generateFile(schema, 'Simple')

    // Should still import isObject helper
    expect(result).toContain("import { isObject } from './helpers/is-object';")
    // But should not import any ref types (check for type imports specifically)
    expect(result).not.toContain("import { type")
  })

  it('still validates non-ref properties inline', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const result = generateFile(schema, 'Document')

    // Non-ref property should have inline validation (optimized to use input directly)
    expect(result).toContain('typeof input?.name === "string"')
    // Ref property should call imported parser using cached variable
    expect(result).toContain('parseContactObject(_contact)')
  })

  it('handles -or-reference suffix in $ref', () => {
    const schema = {
      type: 'object',
      properties: {
        callbacks: { $ref: '#/$defs/callbacks-or-reference' },
      },
    }

    const result = generateFile(schema, 'Document')

    // Should strip -or-reference suffix
    expect(result).toContain("import { type CallbacksObject, parseCallbacksObject } from './callbacks';")
    expect(result).toContain('parseCallbacksObject(_callbacks)')
  })

  it('generates arrow function parser', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = generateFile(schema, 'Simple')

    expect(result).toContain('export const parseSimple = (input: unknown): Simple =>')
    expect(result).not.toContain('function parseSimple')
  })

  it('maps array items through imported parser for optional array with $ref items', () => {
    const schema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const result = generateFile(schema, 'Document')

    expect(result).toContain("import { type ServerObject, parseServerObject } from './server';")
    // With local variable caching, array validators use the cached variable
    expect(result).toContain('validateArray(_servers, parseServerObject)')
  })

  it('maps array items through imported parser for required array with $ref items', () => {
    const schema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
      required: ['servers'],
    }

    const result = generateFile(schema, 'Document')

    // Check for required imports
    expect(result).toContain("import { type ServerObject, parseServerObject } from './server';")
    expect(result).toContain("import { validateArray } from './validators/validate-array';")
    expect(result).toContain("import { isObject } from './helpers/is-object';")

    // Check for required array validation using cached variable
    expect(result).toContain('servers: validateArray(_servers, parseServerObject),')

    // Should not use spread operator for required fields
    expect(result).not.toContain('...(_servers')
  })

  it('generates type and parser for schema with extension properties', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        'x-enabled': { type: 'boolean' },
        'x-internal': { type: 'boolean' },
      },
      required: ['name'],
    }

    const result = generateFile(schema, 'Parameter')

    // Type should include extension properties as optional
    expect(result).toContain("'x-enabled'?: boolean")
    expect(result).toContain("'x-internal'?: boolean")
    // Parser should validate extension properties
    expect(result).toContain('x_enabled')
    expect(result).toContain('x_internal')
  })

  it('generates type and parser for schema with complex extension property', () => {
    const schema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        'x-codegen': {
          type: 'object',
          properties: {
            methodName: { type: 'string' },
          },
        },
      },
    }

    const result = generateFile(schema, 'Operation')

    // Type should include the complex extension
    expect(result).toContain("'x-codegen'")
    expect(result).toContain('methodName')
  })

  it('omits parser function in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = generateFile(schema, 'Simple', undefined, { typesOnly: true })

    expect(result).toContain('export type Simple')
    expect(result).not.toContain('export const parseSimple')
  })

  it('uses type-only imports for $ref properties in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const result = generateFile(schema, 'Document', undefined, { typesOnly: true })

    expect(result).toContain("import type { ContactObject } from './contact';")
    expect(result).not.toContain('parseContactObject')
  })

  it('does not include runtime helper imports in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = generateFile(schema, 'Simple', undefined, { typesOnly: true })

    // No parser helpers should be imported since there is no parser function
    expect(result).not.toContain("import { isObject }")
    expect(result).not.toContain("import { validateArray }")
    expect(result).not.toContain("import { validateRecord }")
  })

  it('still generates the type definition in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    }

    const result = generateFile(schema, 'User', undefined, { typesOnly: true })

    expect(result).toContain('export type User')
    expect(result).toContain('name: string')
    expect(result).toContain('age?: number')
  })

  it('generates type-only import for array items $ref in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const result = generateFile(schema, 'Document', undefined, { typesOnly: true })

    expect(result).toContain("import type { ServerObject } from './server';")
    expect(result).not.toContain('parseServerObject')
    expect(result).not.toContain('validateArray')
  })

  it('generates type-only import for additionalProperties $ref in types-only mode', () => {
    const schema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = generateFile(schema, 'Paths', undefined, { typesOnly: true })

    expect(result).toContain("import type { PathItemObject } from './path-item';")
    expect(result).not.toContain('parsePathItemObject')
    expect(result).not.toContain('validateRecord')
  })

  it('generates type-only imports for oneOf $ref variants in types-only mode', () => {
    const schema = {
      oneOf: [{ $ref: '#/$defs/cat' }, { $ref: '#/$defs/dog' }],
    }

    const result = generateFile(schema, 'Pet', undefined, { typesOnly: true })

    expect(result).toContain("import type { CatObject } from './cat';")
    expect(result).toContain("import type { DogObject } from './dog';")
    expect(result).not.toContain('parseCatObject')
    expect(result).not.toContain('parseDogObject')
  })

  it('generates type-only imports for anyOf $ref variants in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ $ref: '#/$defs/string-value' }, { $ref: '#/$defs/number-value' }],
        },
      },
    }

    const result = generateFile(schema, 'Wrapper', undefined, { typesOnly: true })

    expect(result).toContain("import type { StringValueObject } from './string-value';")
    expect(result).toContain("import type { NumberValueObject } from './number-value';")
    expect(result).not.toContain('parseStringValueObject')
    expect(result).not.toContain('parseNumberValueObject')
  })

  it('does not change default behavior when typesOnly is false', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const defaultResult = generateFile(schema, 'Document')
    const explicitFalseResult = generateFile(schema, 'Document', undefined, { typesOnly: false })

    expect(defaultResult).toBe(explicitFalseResult)
    expect(defaultResult).toContain("import { type ContactObject, parseContactObject } from './contact';")
    expect(defaultResult).toContain('export const parseDocument')
  })
})
