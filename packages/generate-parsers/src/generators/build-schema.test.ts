import { describe, expect, it, spyOn } from 'bun:test'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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
    const filenames = result.map((file) => file.filename)
    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('schema.ts')
  })

  it('emits a types-only schema.ts (no runtime code) in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const filenames = result.map((file) => file.filename)
    const schemaFile = result.find((file) => file.filename === 'schema.ts')

    expect(filenames).toContain('schema.ts')
    // Types-only schema.ts should export SchemaObject but have no runtime parser code
    expect(schemaFile?.content).toContain('export type SchemaObject')
    expect(schemaFile?.content).not.toContain('parseSchemaObject')
    expect(schemaFile?.content).not.toContain("from 'mjst-helpers/is-object'")
  })

  it('only generates type files in types-only mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)

    // document.ts plus the types-only schema.ts — no other runtime helpers
    expect(result).toHaveLength(2)
    const filenames = result.map((f) => f.filename)
    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('schema.ts')
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
    // Types-only schema.ts is included; no other runtime helpers
    expect(filenames).toContain('schema.ts')
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

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await buildSchema(schema, 'Document')

    expect(warnSpy).toHaveBeenCalledWith('Warning: Could not resolve ref: #/$defs/nonexistent')
    // The root document file should still be generated despite the unresolvable ref
    expect(result.some((file) => file.filename === 'document.ts')).toBe(true)

    warnSpy.mockRestore()
  })

  it('merges allOf property-mixin ref properties into the type and parser', async () => {
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // Mixin property should appear in the generated type
    expect(documentFile?.content).toContain('tags?:')
    // Own property should still be present
    expect(documentFile?.content).toContain('name?:')
  })

  it('does not import the mixin ref itself — only imports from its resolved properties', async () => {
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
              additionalProperties: { $ref: '#/$defs/example-or-reference' },
            },
          },
        },
        'example-or-reference': {
          type: 'object',
          properties: { value: { type: 'string' } },
        },
      },
    }

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // Should NOT import ExamplesObject since it was merged as a mixin
    expect(documentFile?.content).not.toContain('ExamplesObject')
    // Should import ExampleObject (resolved from example-or-reference) since it is used
    // by the merged `examples` property's additionalProperties
    expect(documentFile?.content).toContain('ExampleObject')
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // The conditional ref should NOT be merged — Document should only have `name`
    expect(documentFile?.content).not.toContain('style?:')
    expect(documentFile?.content).not.toContain('explode?:')
  })

  it('skips specification-extensions allOf ref without merging or importing it', async () => {
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

    const result = await buildSchema(schema, 'Document', undefined, undefined, true)
    const documentFile = result.find((file) => file.filename === 'document.ts')

    // specification-extensions is handled separately by the type generator as
    // Record<`x-${string}`, unknown> — it should not be merged as a mixin property
    expect(documentFile?.content).not.toContain("'x-custom'")
    expect(documentFile?.content).not.toContain('SpecificationExtensionsObject')
  })

  it('injects $comment fallback for schemas missing one when markdown is provided', async () => {
    // Simulates the oauth-flows pattern: nested $defs without $comment that share a
    // single spec section (e.g. all four OAuth flow types point to "oauth-flow-object").
    const markdown = `
#### Oauth Flow Object

Configuration details for a supported OAuth Flow

##### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| tokenUrl | \`string\` | **REQUIRED**. The token URL. |
| scopes | Map | **REQUIRED**. The available scopes. |
`

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
              // No $comment — relies on COMMENT_FALLBACKS
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

    const result = await buildSchema(schema, 'Document', markdown)
    const passwordFile = result.find((file) => file.filename === 'password.ts')

    expect(passwordFile).toBeDefined()
    // JSDoc should be present because the fallback $comment points to the markdown section
    expect(passwordFile?.content).toContain('The token URL.')
    expect(passwordFile?.content).toContain('The available scopes.')
  })

  it('does not inject $comment fallback when schema already has one', async () => {
    const markdown = `
#### Oauth Flow Object

Configuration details for a supported OAuth Flow

##### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| tokenUrl | \`string\` | The token URL from fallback. |

#### Custom Flow Object

Custom flow description.

##### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| tokenUrl | \`string\` | The token URL from own comment. |
`

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
              // Has its own $comment — fallback should NOT override it
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

    const result = await buildSchema(schema, 'Document', markdown)
    const passwordFile = result.find((file) => file.filename === 'password.ts')

    expect(passwordFile).toBeDefined()
    // Should use own $comment, not the fallback
    expect(passwordFile?.content).toContain('The token URL from own comment.')
    expect(passwordFile?.content).not.toContain('The token URL from fallback.')
  })

  it('does not generate a file for -or-reference defs', async () => {
    // #/$defs/parameter-or-reference and #/$defs/parameter both map to the filename
    // "parameter" via refToFilename. The -or-reference def is just an if/then/else
    // union (Parameter | Reference) that is inlined at usage sites — it should not
    // produce its own file, which would collide with and overwrite the real parameter.ts.
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

    // Only one parameter.ts — from #/$defs/parameter, not from #/$defs/parameter-or-reference
    expect(filenames.filter((f) => f === 'parameter.ts')).toHaveLength(1)
    // The parameter.ts should contain the real ParameterObject type, not an empty shell
    const parameterFile = result.find((f) => f.filename === 'parameter.ts')
    expect(parameterFile?.content).toContain('name')
    expect(parameterFile?.content).toContain('in')
    // No file should be generated for the -or-reference def itself
    expect(filenames).not.toContain('parameter-or-reference.ts')
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
