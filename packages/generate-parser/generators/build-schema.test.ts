import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it, vi } from 'vitest'
import { buildSchema } from './build-schema'

describe('build-schema', () => {
  it('does not generate schema.ts for #/$defs/schema references', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
        contact: { $ref: '#/$defs/contact' },
      },
      $defs: {
        schema: {
          type: 'object',
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
    // The schema.ts file should be the template file, not a generated file from #/$defs/schema
    const schemaFile = result.find((file) => file.filename === 'schema.ts')
    expect(schemaFile).toBeDefined()
    // Verify it's the template by checking for SchemaObject type export
    expect(schemaFile?.content).toContain('export type SchemaObject')
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

    const result = await buildSchema(schema, 'Document', undefined, {
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

    const result = await buildSchema(schema, 'Document', undefined, {
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

    const result = await buildSchema(schema, 'Document', undefined, {
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
    // Should include document.ts plus the 4 utility files (validators, helpers, and schema template)
    expect(result).toHaveLength(5)
    const filenames = result.map((file) => file.filename)
    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('validators/validate-array.ts')
    expect(filenames).toContain('validators/validate-record.ts')
    expect(filenames).toContain('helpers/is-object.ts')
    expect(filenames).toContain('schema.ts')
  })

  it('omits all runtime helper files in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const filenames = result.map((file) => file.filename)

    expect(filenames).not.toContain('validators/validate-array.ts')
    expect(filenames).not.toContain('validators/validate-record.ts')
    expect(filenames).not.toContain('helpers/is-object.ts')
    expect(filenames).not.toContain('schema.ts')
  })

  it('only generates type files in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)

    // Only the document type file — no runtime helpers
    expect(result).toHaveLength(1)
    expect(result[0]?.filename).toBe('document.ts')
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const filenames = result.map((file) => file.filename)

    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('contact.ts')
    expect(filenames).toContain('server.ts')
    // No runtime helpers
    expect(result).toHaveLength(3)
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
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

    const result = await buildSchema(
      schema,
      'Document',
      undefined,
      { parameter: { 'x-enabled': { type: 'boolean' } } },
      true,
    )

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

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await buildSchema(schema, 'Document')

    expect(warnSpy).toHaveBeenCalledWith('Warning: Could not resolve ref: #/$defs/nonexistent')
    // The root document file should still be generated despite the unresolvable ref
    expect(result.some((file) => file.filename === 'document.ts')).toBe(true)

    warnSpy.mockRestore()
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
