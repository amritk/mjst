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

    const { content: result } = generateFile(schema, 'Document')

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
  })

  it('calls imported parser for optional $ref property', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const { content: result } = generateFile(schema, 'Document')

    // With local variable caching, optional $ref properties use the cached variable
    expect(result).toContain('_contact !== undefined && { contact: parseContact(_contact) }')
  })

  it('calls imported parser for required $ref property', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      required: ['contact'],
    }

    const { content: result } = generateFile(schema, 'Document')

    // With local variable caching, required $ref properties use the cached variable
    expect(result).toContain('contact: parseContact(_contact),')
  })

  it('generates combined imports for multiple $ref properties', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const { content: result } = generateFile(schema, 'Document')

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('generates correct parser name for multi-word $ref', () => {
    const schema = {
      type: 'object',
      properties: {
        externalDoc: { $ref: '#/$defs/external-documentation' },
      },
    }

    const { content: result } = generateFile(schema, 'Document')

    expect(result).toContain(
      "import { type ExternalDocumentation, parseExternalDocumentation, validateExternalDocumentationShape } from './external-documentation.js';",
    )
    expect(result).toContain('parseExternalDocumentation(_externalDoc)')
  })

  it('does not generate ref imports when no $ref properties exist', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }

    const { content: result } = generateFile(schema, 'Simple')

    // Should still import isObject helper
    expect(result).toContain("import { isObject } from '@amritk/helpers/is-object';")
    // But should not import any ref types (check for type imports specifically)
    expect(result).not.toContain('import { type')
  })

  it('still validates non-ref properties inline', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const { content: result } = generateFile(schema, 'Document')

    // Non-ref property should have inline validation against the cached local
    expect(result).toContain('typeof _name === "string"')
    // Ref property should call imported parser using cached variable
    expect(result).toContain('parseContact(_contact)')
  })

  it('generates a correct import for -or-reference style $ref names', () => {
    // Without stripping, 'callbacks-or-reference' maps to the filename 'callbacks-or-reference'
    const schema = {
      type: 'object',
      properties: {
        callbacks: { $ref: '#/$defs/callbacks-or-reference' },
      },
    }

    const { content: result } = generateFile(schema, 'Document')

    expect(result).toContain(
      "import { type CallbacksOrReference, parseCallbacksOrReference, validateCallbacksOrReferenceShape } from './callbacks-or-reference.js';",
    )
    expect(result).toContain('parseCallbacksOrReference(_callbacks)')
  })

  it('generates arrow function parser', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const { content: result } = generateFile(schema, 'Simple')

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

    const { content: result } = generateFile(schema, 'Document')

    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
    // With local variable caching, array validators use the cached variable
    expect(result).toContain('validateArray(_servers, parseServer)')
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

    const { content: result } = generateFile(schema, 'Document')

    // Check for required imports
    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
    expect(result).toContain("import { validateArray } from '@amritk/helpers/validate-array';")
    expect(result).toContain("import { isObject } from '@amritk/helpers/is-object';")

    // Check for required array validation using cached variable
    expect(result).toContain('servers: validateArray(_servers, parseServer),')

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

    const { content: result } = generateFile(schema, 'Parameter')

    // Type should include extension properties as optional
    expect(result).toContain('"x-enabled"?: boolean')
    expect(result).toContain('"x-internal"?: boolean')
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

    const { content: result } = generateFile(schema, 'Operation')

    // Type should include the complex extension
    expect(result).toContain('"x-codegen"')
    expect(result).toContain('methodName')
  })

  it('omits parser function in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const { content: result } = generateFile(schema, 'Simple', { typesOnly: true })

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

    const { content: result } = generateFile(schema, 'Document', { typesOnly: true })

    expect(result).toContain("import type { Contact } from './contact.js';")
    expect(result).not.toContain('parseContact')
  })

  it('does not include runtime helper imports in types-only mode', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const { content: result } = generateFile(schema, 'Simple', { typesOnly: true })

    // No parser helpers should be imported since there is no parser function
    expect(result).not.toContain('import { isObject }')
    expect(result).not.toContain('import { validateArray }')
    expect(result).not.toContain('import { validateRecord }')
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

    const { content: result } = generateFile(schema, 'User', { typesOnly: true })

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

    const { content: result } = generateFile(schema, 'Document', { typesOnly: true })

    expect(result).toContain("import type { Server } from './server.js';")
    expect(result).not.toContain('parseServer')
    expect(result).not.toContain('validateArray')
  })

  it('generates type-only import for additionalProperties $ref in types-only mode', () => {
    const schema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const { content: result } = generateFile(schema, 'Paths', { typesOnly: true })

    expect(result).toContain("import type { PathItem } from './path-item.js';")
    expect(result).not.toContain('parsePathItem')
    expect(result).not.toContain('validateRecord')
  })

  it('generates type-only imports for oneOf $ref variants in types-only mode', () => {
    const schema = {
      oneOf: [{ $ref: '#/$defs/cat' }, { $ref: '#/$defs/dog' }],
    }

    const { content: result } = generateFile(schema, 'Pet', { typesOnly: true })

    expect(result).toContain("import type { Cat } from './cat.js';")
    expect(result).toContain("import type { Dog } from './dog.js';")
    expect(result).not.toContain('parseCat')
    expect(result).not.toContain('parseDog')
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

    const { content: result } = generateFile(schema, 'Wrapper', { typesOnly: true })

    expect(result).toContain("import type { StringValue } from './string-value.js';")
    expect(result).toContain("import type { NumberValue } from './number-value.js';")
    expect(result).not.toContain('parseStringValue')
    expect(result).not.toContain('parseNumberValue')
  })

  it('does not change default behavior when typesOnly is false', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const { content: defaultResult } = generateFile(schema, 'Document')
    const { content: explicitFalseResult } = generateFile(schema, 'Document', { typesOnly: false })

    expect(defaultResult).toBe(explicitFalseResult)
    expect(defaultResult).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
    expect(defaultResult).toContain('export const parseDocument')
  })

  it('does not generate a self-import for recursive schemas in types-only mode', () => {
    // Mirrors the 3.2.0 encoding schema: Encoding has properties itemEncoding, prefixEncoding,
    // and encoding that all $ref back to #/$defs/encoding. The generated encoding.ts must not
    // import Encoding from itself.
    const schema = {
      type: 'object',
      properties: {
        itemEncoding: { $ref: '#/$defs/encoding' },
        prefixEncoding: {
          type: 'array',
          items: { $ref: '#/$defs/encoding' },
        },
        encoding: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/encoding' },
        },
        headers: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/header-or-reference' },
        },
      },
    }

    const { content: result } = generateFile(schema, 'Encoding', {
      typesOnly: true,
      selfRef: '#/$defs/encoding',
    })

    expect(result).not.toContain("import type { Encoding } from './encoding.js';")
    expect(result).toContain("import type { HeaderOrReference } from './header-or-reference.js';")
    expect(result).toContain('export type Encoding')
  })

  it('does not generate a self-import for recursive schemas in full parser mode', () => {
    const schema = {
      type: 'object',
      properties: {
        itemEncoding: { $ref: '#/$defs/encoding' },
        headers: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/header-or-reference' },
        },
      },
    }

    const { content: result } = generateFile(schema, 'Encoding', { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("import { type Encoding, parseEncoding, validateEncodingShape } from './encoding.js';")
    expect(result).toContain(
      "import { type HeaderOrReference, parseHeaderOrReference, validateHeaderOrReferenceShape } from './header-or-reference.js';",
    )
  })

  describe('typeSuffix', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      required: ['contact'],
    }

    it('appends the suffix to ref-derived type, parser, and import names', () => {
      const { content: result } = generateFile(schema, 'Document', { typeSuffix: 'Object' })

      expect(result).toContain(
        "import { type ContactObject, parseContactObject, validateContactObjectShape } from './contact.js';",
      )
      expect(result).toContain('contact: ContactObject;')
      expect(result).toContain('contact: parseContactObject(_contact)')
    })

    it('emits no suffix by default', () => {
      const { content: result } = generateFile(schema, 'Document')

      expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
      expect(result).not.toContain('ContactObject')
    })
  })
})
