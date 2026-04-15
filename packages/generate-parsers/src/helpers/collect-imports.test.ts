import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'bun:test'
import { collectImports } from './collect-imports'

describe('collect-imports', () => {
  it('collects imports from properties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type ContactObject, parseContactObject } from './contact';",
      "import { type ServerObject, parseServerObject } from './server';",
    ])
  })

  it('collects imports from array items with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type ServerObject, parseServerObject } from './server';"])
  })

  it('collects imports from additionalProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        webhooks: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItemObject, parsePathItemObject } from './path-item';"])
  })

  it('collects imports from non-extension patternProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItemObject, parsePathItemObject } from './path-item';"])
  })

  it('does not collect imports from ^x- vendor extension patternProperties', () => {
    // ^x- patterns are inlined as Record<`x-${string}`, unknown> and produce no named import.
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^x-': { $ref: '#/$defs/vendor-extension' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('collects imports only from non-extension patterns when mixed patternProperties are present', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^x-': { $ref: '#/$defs/vendor-extension' },
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItemObject, parsePathItemObject } from './path-item';"])
  })

  it('collects imports from oneOf with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: {
          oneOf: [{ $ref: '#/$defs/response' }, { $ref: '#/$defs/reference' }],
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type ReferenceObject, parseReferenceObject } from './reference';",
      "import { type ResponseObject, parseResponseObject } from './response';",
    ])
  })

  it('collects imports from anyOf with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ $ref: '#/$defs/string-value' }, { $ref: '#/$defs/number-value' }],
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type NumberValueObject, parseNumberValueObject } from './number-value';",
      "import { type StringValueObject, parseStringValueObject } from './string-value';",
    ])
  })

  it('collects imports from allOf with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        combined: {
          allOf: [{ $ref: '#/$defs/base' }, { $ref: '#/$defs/extension' }],
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type BaseObject, parseBaseObject } from './base';",
      "import { type ExtensionObject, parseExtensionObject } from './extension';",
    ])
  })

  it('deduplicates imports by filename', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact1: { $ref: '#/$defs/contact' },
        contact2: { $ref: '#/$defs/contact' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type ContactObject, parseContactObject } from './contact';"])
  })

  it('adds ReferenceObject import for -or-reference refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: { $ref: '#/$defs/response-or-reference' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import type { ReferenceObject } from './reference';",
      "import { type ResponseObject, parseResponseObject } from './response';",
    ])
  })

  it('handles nested refs in complex schemas', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
        callbacks: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/callback' },
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type CallbackObject, parseCallbackObject } from './callback';",
      "import { type ServerObject, parseServerObject } from './server';",
    ])
  })

  it('collects imports from root-level additionalProperties', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItemObject, parsePathItemObject } from './path-item';"])
  })

  it('imports SchemaObject parser and type from template file', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type SchemaObject, parseSchemaObject } from './schema';"])
  })

  it('handles empty schema', () => {
    const schema: JSONSchema = {
      type: 'object',
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('handles schema without properties', () => {
    const schema: JSONSchema = {
      type: 'string',
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('collects imports from root-level allOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      allOf: [
        { $ref: '#/$defs/security-scheme/$defs/type-apikey' },
        { $ref: '#/$defs/security-scheme/$defs/type-http' },
      ],
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type TypeApikeyObject, parseTypeApikeyObject } from './type-apikey';",
      "import { type TypeHttpObject, parseTypeHttpObject } from './type-http';",
    ])
  })

  it('imports all allOf refs including ones with generic names', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contentType: { type: 'string' },
      },
      allOf: [
        { $ref: '#/$defs/specification-extensions' },
        { $ref: '#/$defs/styles-for-form' },
      ],
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type SpecificationExtensionsObject, parseSpecificationExtensionsObject } from './specification-extensions';",
      "import { type StylesForFormObject, parseStylesForFormObject } from './styles-for-form';",
    ])
  })

  it('generates type-only imports when typesOnly is true', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { ContactObject } from './contact';",
      "import type { ServerObject } from './server';",
    ])
  })

  it('does not include parser names in type-only imports', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { ContactObject } from './contact';"])
    expect(result[0]).not.toContain('parseContactObject')
  })

  it('still adds ReferenceObject import for -or-reference refs in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: { $ref: '#/$defs/response-or-reference' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    // ReferenceObject is a type-only import in both modes
    expect(result).toEqual([
      "import type { ReferenceObject } from './reference';",
      "import type { ResponseObject } from './response';",
    ])
  })

  it('generates type-only imports from array items $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { ServerObject } from './server';"])
  })

  it('generates type-only imports from additionalProperties $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { PathItemObject } from './path-item';"])
  })

  it('generates type-only imports from anyOf $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ $ref: '#/$defs/string-value' }, { $ref: '#/$defs/number-value' }],
        },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { NumberValueObject } from './number-value';",
      "import type { StringValueObject } from './string-value';",
    ])
  })

  it('generates type-only imports from allOf $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      allOf: [{ $ref: '#/$defs/base' }, { $ref: '#/$defs/extension' }],
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { BaseObject } from './base';",
      "import type { ExtensionObject } from './extension';",
    ])
  })

  it('deduplicates type-only imports by filename', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact1: { $ref: '#/$defs/contact' },
        contact2: { $ref: '#/$defs/contact' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { ContactObject } from './contact';"])
  })

  it('returns empty array for schema with no $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([])
  })

  it('collects imports from root-level array items with $ref', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { $ref: '#/$defs/server' },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type ServerObject, parseServerObject } from './server';"])
  })

  it('collects imports from root-level array items with -or-reference $ref', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { $ref: '#/$defs/parameter-or-reference' },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { ReferenceObject } from './reference';",
      "import type { ParameterObject } from './parameter';",
    ])
  })

  it('collects imports from root-level oneOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      oneOf: [{ $ref: '#/$defs/contact' }, { $ref: '#/$defs/server' }],
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type ContactObject, parseContactObject } from './contact';")
    expect(result).toContain("import { type ServerObject, parseServerObject } from './server';")
  })

  it('collects imports from root-level anyOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/contact' }, { $ref: '#/$defs/server' }],
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type ContactObject, parseContactObject } from './contact';")
    expect(result).toContain("import { type ServerObject, parseServerObject } from './server';")
  })

  it('collects imports from root-level if branch', () => {
    const schema: JSONSchema = {
      if: { $ref: '#/$defs/contact' },
      then: { type: 'object' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type ContactObject, parseContactObject } from './contact';")
  })

  it('collects imports from root-level then branch', () => {
    const schema: JSONSchema = {
      if: { type: 'object' },
      then: { $ref: '#/$defs/server' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type ServerObject, parseServerObject } from './server';")
  })

  it('collects imports from root-level else branch', () => {
    const schema: JSONSchema = {
      if: { type: 'object' },
      else: { $ref: '#/$defs/contact' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type ContactObject, parseContactObject } from './contact';")
  })

  it('does not generate a self-import when a schema references its own $defs key via a property', () => {
    // Mirrors the encoding schema: encoding.ts has a property `itemEncoding` that is a direct
    // $ref back to #/$defs/encoding. Generating `import ... from './encoding'` inside encoding.ts
    // would be a circular self-import that crashes at runtime.
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        itemEncoding: { $ref: '#/$defs/encoding' },
        header: { $ref: '#/$defs/header' },
      },
    }

    const result = collectImports(schema, { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
    expect(result).toContain("import { type HeaderObject, parseHeaderObject } from './header';")
  })

  it('does not generate a self-import when a schema references its own $defs key via additionalProperties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        encoding: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/encoding' },
        },
      },
    }

    const result = collectImports(schema, { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
  })

  it('does not generate a self-import when a schema references its own $defs key via array items', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        prefixEncoding: {
          type: 'array',
          items: { $ref: '#/$defs/encoding' },
        },
      },
    }

    const result = collectImports(schema, { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
  })

  it('does not collect imports for external $refs', () => {
    // External refs (e.g. from draft-04 schemas) cannot be resolved locally and have no generated file.
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        maximum: { $ref: 'http://json-schema.org/draft-04/schema#/properties/maximum' },
        name: { type: 'string' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('does not generate a self-import in types-only mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        itemEncoding: { $ref: '#/$defs/encoding' },
        header: { $ref: '#/$defs/header' },
      },
    }

    const result = collectImports(schema, { typesOnly: true, selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
    expect(result).toContain("import type { HeaderObject } from './header';")
  })
})
