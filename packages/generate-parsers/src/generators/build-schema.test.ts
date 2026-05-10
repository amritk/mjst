import { describe, expect, it, spyOn } from 'bun:test'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { buildSchema } from './build-schema'

describe('build-schema', () => {
  it('generates schema.ts from #/$defs/schema like any other ref', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
        contact: { $ref: '#/$defs/contact' },
      },
      $defs: {
        schema: {
          type: 'object',
          properties: {
            type: { type: 'string' },
          },
        },
        contact: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const filenames = result.map((file) => file.filename)

    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('contact.ts')
    expect(filenames).toContain('schema.ts')
    const schemaFile = result.find((file) => file.filename === 'schema.ts')
    // The generated schema.ts should declare SchemaObject and parseSchemaObject from the user's $defs/schema
    expect(schemaFile?.content).toContain('export type SchemaObject')
    expect(schemaFile?.content).toContain('parseSchemaObject')
  })

  it('applies extensions to matching definitions during build', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        parameter: { $ref: '#/$defs/parameter' },
      },
      $defs: {
        parameter: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
      },
    }

    const result = await buildSchema(schema, 'Document', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    const parameterFile = result.find((file) => file.filename === 'parameter.ts')
    expect(parameterFile).toBeDefined()
    // The generated type should include the x-enabled extension property
    expect(parameterFile?.content).toContain("'x-enabled'")
    // The generated parser should validate the extension property
    expect(parameterFile?.content).toContain('x_enabled')
  })

  it('does not affect definitions without matching extensions', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        parameter: { $ref: '#/$defs/parameter' },
        info: { $ref: '#/$defs/info' },
      },
      $defs: {
        parameter: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        info: {
          type: 'object',
          properties: {
            title: { type: 'string' },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    const infoFile = result.find((file) => file.filename === 'info.ts')
    expect(infoFile).toBeDefined()
    // The info file should not contain the extension
    expect(infoFile?.content).not.toContain('x-enabled')
  })

  it('applies extensions to the root schema', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        openapi: { type: 'string' },
      },
      required: ['openapi'],
    }

    const result = await buildSchema(schema, 'Document', {
      document: {
        'x-generator': { type: 'string' },
      },
    })

    const documentFile = result.find((file) => file.filename === 'document.ts')
    expect(documentFile).toBeDefined()
    expect(documentFile?.content).toContain("'x-generator'")
  })

  it('works without extensions parameter', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const filenames = result.map((file) => file.filename)
    expect(filenames).toContain('document.ts')
    // No schema.ts unless the input defines #/$defs/schema
    expect(filenames).not.toContain('schema.ts')
  })

  it('only generates type files in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)

    // document.ts plus index.ts — no schema.ts since input has no #/$defs/schema
    expect(result).toHaveLength(2)
    const filenames = result.map((f) => f.filename)
    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('index.ts')
  })

  it('does not include parser functions in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    expect(documentFile?.content).toContain('export type Document')
    expect(documentFile?.content).not.toContain('export const parseDocument')
  })

  it('uses type-only imports for $ref properties in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      $defs: {
        contact: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    expect(documentFile?.content).toContain("import type { ContactObject } from './contact';")
    expect(documentFile?.content).not.toContain('parseContactObject')
  })

  it('still generates files for all $ref definitions in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
      $defs: {
        contact: {
          type: 'object',
          properties: { email: { type: 'string' } },
        },
        server: {
          type: 'object',
          properties: { url: { type: 'string' } },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const filenames = result.map((file) => file.filename)

    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('contact.ts')
    expect(filenames).toContain('server.ts')
    expect(filenames).toContain('index.ts')
    expect(result).toHaveLength(4)
  })

  it('generated ref files in types-only mode also omit parsers', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      $defs: {
        contact: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
          required: ['email'],
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const contactFile = result.find((file) => file.filename === 'contact.ts')

    expect(contactFile?.content).toContain('export type ContactObject')
    expect(contactFile?.content).not.toContain('export const parseContactObject')
  })

  it('applies extensions correctly in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        parameter: { $ref: '#/$defs/parameter' },
      },
      $defs: {
        parameter: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
      },
    }

    const result = await buildSchema(schema, 'Document', { parameter: { 'x-enabled': { type: 'boolean' } } }, true)

    const parameterFile = result.find((file) => file.filename === 'parameter.ts')
    // Extension property should still appear in the type
    expect(parameterFile?.content).toContain("'x-enabled'")
    // But no parser should be generated
    expect(parameterFile?.content).not.toContain('parseParameterObject')
  })

  it('warns and skips when a $ref cannot be resolved', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        // This ref points to a def that does not exist in $defs
        ghost: { $ref: '#/$defs/nonexistent' },
      },
      $defs: {},
    }

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await buildSchema(schema, 'Document')

    expect(warnSpy).toHaveBeenCalledWith('Warning: Could not resolve ref: #/$defs/nonexistent')
    // The root document file should still be generated despite the unresolvable ref
    expect(result.some((file) => file.filename === 'document.ts')).toBe(true)

    warnSpy.mockRestore()
  })

  it('generates intersection type for schema with allOf $ref', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/taggable' }],
      $defs: {
        taggable: {
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // Own property should be present in the object literal
    expect(documentFile?.content).toContain('name?:')
    // allOf ref generates an intersection type with the referenced type
    expect(documentFile?.content).toContain('TaggableObject')
    // The taggable definition should generate its own file
    const filenames = result.map((f) => f.filename)
    expect(filenames).toContain('taggable.ts')
  })

  it('generates a separate file for allOf $ref definition and imports it via intersection type', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/examples' }],
      $defs: {
        examples: {
          properties: {
            example: true,
            examples: {
              type: 'object',
              additionalProperties: { $ref: '#/$defs/example-item' },
            },
          },
        },
        'example-item': {
          type: 'object',
          properties: { value: { type: 'string' } },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const documentFile = result.find((file) => file.filename === 'document.ts')
    const filenames = result.map((f) => f.filename)

    // ExamplesObject IS imported since allOf generates an intersection type
    expect(documentFile?.content).toContain('ExamplesObject')
    // The examples definition generates its own file
    expect(filenames).toContain('examples.ts')
    // ExampleItemObject is also resolved from additionalProperties
    expect(filenames).toContain('example-item.ts')
  })

  it('own properties take precedence over mixin properties with the same key', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        // Own `tags` property overrides the mixin's `tags`
        tags: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/taggable' }],
      $defs: {
        taggable: {
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // Own `tags: string` should win over mixin `tags: string[]`
    expect(documentFile?.content).toContain('tags?: string')
    expect(documentFile?.content).not.toContain('tags?: string[]')
  })

  it('does not merge allOf refs that have structural keywords (non-mixin)', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/conditional' }],
      $defs: {
        conditional: {
          // Has `if`/`then` — not a pure property mixin
          if: { properties: { style: { const: 'form' } }, required: ['style'] },
          then: { properties: { explode: { default: true } } },
          properties: { style: { type: 'string' }, explode: { type: 'boolean' } },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // The conditional ref should NOT be merged — Document should only have `name`
    expect(documentFile?.content).not.toContain('style?:')
    expect(documentFile?.content).not.toContain('explode?:')
  })

  it('generates intersection type for allOf $ref including specification-extensions', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/specification-extensions' }],
      $defs: {
        'specification-extensions': {
          properties: {
            'x-custom': { type: 'string' },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const documentFile = result.find((file) => file.filename === 'document.ts')
    const filenames = result.map((f) => f.filename)

    // specification-extensions is now treated like any other allOf ref
    expect(documentFile?.content).toContain('SpecificationExtensionsObject')
    // The specification-extensions definition generates its own file
    expect(filenames).toContain('specification-extensions.ts')
    // x-custom property is NOT inlined into document.ts — it's in specification-extensions.ts
    expect(documentFile?.content).not.toContain("'x-custom'")
  })

  it('generates JSDoc from $comment plain text on nested $defs', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        flows: { $ref: '#/$defs/oauth-flows' },
      },
      $defs: {
        'oauth-flows': {
          type: 'object',
          properties: {
            password: { $ref: '#/$defs/oauth-flows/$defs/password' },
          },
          $defs: {
            password: {
              $comment: 'Configuration details for a supported OAuth Flow.',
              type: 'object',
              properties: {
                tokenUrl: { type: 'string' },
                scopes: { type: 'object' },
              },
              required: ['tokenUrl', 'scopes'],
            },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const passwordFile = result.find((file) => file.filename === 'password.ts')

    expect(passwordFile).toBeDefined()
    // JSDoc should contain the plain-text $comment description
    expect(passwordFile?.content).toContain('Configuration details for a supported OAuth Flow.')
  })

  it('uses the $comment URL as plain-text JSDoc description', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        flows: { $ref: '#/$defs/oauth-flows' },
      },
      $defs: {
        'oauth-flows': {
          type: 'object',
          properties: {
            password: { $ref: '#/$defs/oauth-flows/$defs/password' },
          },
          $defs: {
            password: {
              $comment: 'https://example.com#custom-flow-object',
              type: 'object',
              properties: {
                tokenUrl: { type: 'string' },
              },
            },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const passwordFile = result.find((file) => file.filename === 'password.ts')

    expect(passwordFile).toBeDefined()
    // URL $comment is emitted as the description in the JSDoc block
    expect(passwordFile?.content).toContain('https://example.com#custom-flow-object')
  })

  it('generates a file for if/then/else conditional refs', async () => {
    // With -or-reference stripping removed, a def named 'parameter-or-reference' now maps
    // to its own filename 'parameter-or-reference' and gets its own file.
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        param: { $ref: '#/$defs/parameter-or-reference' },
      },
      $defs: {
        reference: {
          type: 'object',
          properties: { $ref: { type: 'string' } },
          required: ['$ref'],
        },
        parameter: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            in: { type: 'string' },
          },
          required: ['name', 'in'],
        },
        'parameter-or-reference': {
          if: { type: 'object', required: ['$ref'] },
          then: { $ref: '#/$defs/reference' },
          else: { $ref: '#/$defs/parameter' },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const filenames = result.map((f) => f.filename)

    // Both files are generated independently — they map to different filenames now
    expect(filenames).toContain('parameter.ts')
    expect(filenames).toContain('parameter-or-reference.ts')
    // The parameter.ts should contain the real ParameterObject type
    const parameterFile = result.find((f) => f.filename === 'parameter.ts')
    expect(parameterFile?.content).toContain('name')
    expect(parameterFile?.content).toContain('in')
  })

  it('generates an index.ts with named re-exports from all generated files', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      $defs: {
        contact: {
          type: 'object',
          properties: { email: { type: 'string' } },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const indexFile = result.find((f) => f.filename === 'index.ts')

    expect(indexFile).toBeDefined()
    // Named type + parser + shape-validator exports for each file
    expect(indexFile?.content).toContain(
      "export { type ContactObject, validateContactObjectShape, parseContactObject } from './contact';",
    )
    expect(indexFile?.content).toContain(
      "export { type Document, validateDocumentShape, parseDocument } from './document';",
    )
    // No wildcard exports
    expect(indexFile?.content).not.toContain('export *')
    expect(indexFile?.content).not.toContain('export type *')
  })

  it('generates an index.ts with named type-only re-exports in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      $defs: {
        contact: {
          type: 'object',
          properties: { email: { type: 'string' } },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, true)
    const indexFile = result.find((f) => f.filename === 'index.ts')

    expect(indexFile).toBeDefined()
    // Types-only: export type { ... } syntax, no parsers
    expect(indexFile?.content).toContain("export type { ContactObject } from './contact';")
    expect(indexFile?.content).toContain("export type { Document } from './document';")
    expect(indexFile?.content).not.toContain('parseContactObject')
    expect(indexFile?.content).not.toContain('parseDocument')
    // No wildcard exports
    expect(indexFile?.content).not.toContain('export *')
    expect(indexFile?.content).not.toContain('export type *')
  })

  it('index.ts entries are sorted alphabetically', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        z: { $ref: '#/$defs/zebra' },
        a: { $ref: '#/$defs/alpha' },
      },
      $defs: {
        zebra: { type: 'object', properties: { name: { type: 'string' } } },
        alpha: { type: 'object', properties: { name: { type: 'string' } } },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const indexFile = result.find((f) => f.filename === 'index.ts')

    expect(indexFile).toBeDefined()
    const lines = indexFile?.content.trim().split('\n')
    const sorted = [...lines].sort()
    expect(lines).toEqual(sorted)
  })

  it('skips adding a nested ref to the queue when it was already processed', async () => {
    // When "common" appears first in the root properties it gets processed before "item".
    // Later, when "item" is processed and its nested refs are extracted, "common" is
    // already in processedRefs so it should NOT be added to the queue again (line 184 false branch).
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        common: { $ref: '#/$defs/common' },
        item: { $ref: '#/$defs/item' },
      },
      $defs: {
        common: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        item: {
          type: 'object',
          properties: {
            // item references common, which will already be processed when item is handled
            common: { $ref: '#/$defs/common' },
          },
        },
      },
    }

    const result = await buildSchema(schema, 'Document')
    const filenames = result.map((file) => file.filename)

    // Both defs should produce exactly one file each (no duplicates from re-processing)
    expect(filenames.filter((f) => f === 'common.ts')).toHaveLength(1)
    expect(filenames.filter((f) => f === 'item.ts')).toHaveLength(1)
  })
})
