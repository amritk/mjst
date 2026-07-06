import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

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
      "import { type Contact, parseContact, validateContactShape } from './contact.js';",
      "import { type Server, parseServer, validateServerShape } from './server.js';",
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

    expect(result).toEqual(["import { type Server, parseServer, validateServerShape } from './server.js';"])
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

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('collects imports from non-extension patternProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('collects imports from patternProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
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
      "import { type Reference, parseReference, validateReferenceShape } from './reference.js';",
      "import { type Response, parseResponse, validateResponseShape } from './response.js';",
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
      "import { type NumberValue, parseNumberValue, validateNumberValueShape } from './number-value.js';",
      "import { type StringValue, parseStringValue, validateStringValueShape } from './string-value.js';",
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
      "import { type Base, parseBase, validateBaseShape } from './base.js';",
      "import { type Extension, parseExtension, validateExtensionShape } from './extension.js';",
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

    expect(result).toEqual(["import { type Contact, parseContact, validateContactShape } from './contact.js';"])
  })

  it('collects imports from $ref properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: { $ref: '#/$defs/response' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Response, parseResponse, validateResponseShape } from './response.js';"])
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
      "import { type Callback, parseCallback, validateCallbackShape } from './callback.js';",
      "import { type Server, parseServer, validateServerShape } from './server.js';",
    ])
  })

  it('collects imports from root-level additionalProperties', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('imports Schema parser and type from generated schema.ts', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Schema, parseSchema, validateSchemaShape } from './schema.js';"])
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
      "import { type TypeApikey, parseTypeApikey, validateTypeApikeyShape } from './type-apikey.js';",
      "import { type TypeHttp, parseTypeHttp, validateTypeHttpShape } from './type-http.js';",
    ])
  })

  it('collects imports from all allOf $ref entries', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contentType: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/base-schema' }, { $ref: '#/$defs/styles-for-form' }],
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type BaseSchema, parseBaseSchema, validateBaseSchemaShape } from './base-schema.js';",
      "import { type StylesForForm, parseStylesForForm, validateStylesForFormShape } from './styles-for-form.js';",
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
      "import type { Contact } from './contact.js';",
      "import type { Server } from './server.js';",
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

    expect(result).toEqual(["import type { Contact } from './contact.js';"])
    expect(result[0]).not.toContain('parseContact')
  })

  it('collects type-only imports from $ref properties in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: { $ref: '#/$defs/response' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Response } from './response.js';"])
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

    expect(result).toEqual(["import type { Server } from './server.js';"])
  })

  it('generates type-only imports from additionalProperties $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { PathItem } from './path-item.js';"])
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
      "import type { NumberValue } from './number-value.js';",
      "import type { StringValue } from './string-value.js';",
    ])
  })

  it('generates type-only imports from allOf $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      allOf: [{ $ref: '#/$defs/base' }, { $ref: '#/$defs/extension' }],
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { Base } from './base.js';",
      "import type { Extension } from './extension.js';",
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

    expect(result).toEqual(["import type { Contact } from './contact.js';"])
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

    expect(result).toEqual(["import { type Server, parseServer, validateServerShape } from './server.js';"])
  })

  it('collects imports from root-level array items $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { $ref: '#/$defs/parameter' },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Parameter } from './parameter.js';"])
  })

  it('collects imports from root-level oneOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      oneOf: [{ $ref: '#/$defs/contact' }, { $ref: '#/$defs/server' }],
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('collects imports from root-level anyOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/contact' }, { $ref: '#/$defs/server' }],
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('collects imports from root-level if branch', () => {
    const schema: JSONSchema = {
      if: { $ref: '#/$defs/contact' },
      then: { type: 'object' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
  })

  it('collects imports from root-level then branch', () => {
    const schema: JSONSchema = {
      if: { type: 'object' },
      then: { $ref: '#/$defs/server' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('collects imports from root-level else branch', () => {
    const schema: JSONSchema = {
      if: { type: 'object' },
      else: { $ref: '#/$defs/contact' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
  })

  it('does not generate a self-import when a schema references its own $defs key via a property', () => {
    // Mirrors the encoding schema: encoding.ts has a property `itemEncoding` that is a direct
    // $ref back to #/$defs/encoding. Generating `import ... from './encoding.js'` inside encoding.ts
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
    expect(result).toContain("import { type Header, parseHeader, validateHeaderShape } from './header.js';")
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
    expect(result).toContain("import type { Header } from './header.js';")
  })

  it('emits .ts specifiers when importExt is ts', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
    }

    expect(collectImports(schema, { importExt: 'ts' })).toEqual([
      "import { type Contact, parseContact, validateContactShape } from './contact.ts';",
    ])
    expect(collectImports(schema, { typesOnly: true, importExt: 'ts' })).toEqual([
      "import type { Contact } from './contact.ts';",
    ])
  })
})
