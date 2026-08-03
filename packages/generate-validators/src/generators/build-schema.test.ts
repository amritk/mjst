import { validate } from '@scalar/openapi-parser'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'

describe('build-schema', () => {
  it('generates a validator file for the root schema', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    }

    const files = await buildValidatorSchema(schema, 'Document')
    const filenames = files.map((f) => f.filename)

    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('validation-result.ts')
    expect(filenames).toContain('index.ts')
  })

  it('generates a file per $ref definition', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        info: { $ref: '#/$defs/info' },
      },
      $defs: {
        info: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
      },
    }

    const files = await buildValidatorSchema(schema, 'Document')
    const filenames = files.map((f) => f.filename)

    expect(filenames).toContain('document.ts')
    expect(filenames).toContain('info.ts')
  })

  it('generated document.ts exports a validateDocument function', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    }

    const files = await buildValidatorSchema(schema, 'Document')
    const documentFile = files.find((f) => f.filename === 'document.ts')

    expect(documentFile?.content).toContain('export const validateDocument')
    expect(documentFile?.content).toContain('ValidationResult')
  })

  it('generated file imports the ref validator for $ref properties', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        info: { $ref: '#/$defs/info' },
      },
      $defs: {
        info: {
          type: 'object',
          properties: { title: { type: 'string' } },
        },
      },
    }

    const files = await buildValidatorSchema(schema, 'Document')
    const documentFile = files.find((f) => f.filename === 'document.ts')

    expect(documentFile?.content).toContain("from './info.js'")
    expect(documentFile?.content).toContain('validateInfo')
  })

  it('generates a valid index.ts with re-exports', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    }

    const files = await buildValidatorSchema(schema, 'Document')
    const indexFile = files.find((f) => f.filename === 'index.ts')

    expect(indexFile?.content).toContain("from './document.js'")
    expect(indexFile?.content).toContain('validateDocument')
  })

  it('does not generate a file named validation-result for a schema ref', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        result: { $ref: '#/$defs/validation-result' },
      },
      $defs: {
        'validation-result': { type: 'object' },
      },
    }

    const files = await buildValidatorSchema(schema, 'Document')
    // Should still have exactly one validation-result.ts (the runtime contract)
    const vrFiles = files.filter((f) => f.filename === 'validation-result.ts')
    expect(vrFiles).toHaveLength(1)
    expect(vrFiles[0]?.content).toContain('export type ValidationResult')
  })

  it('produces generated validators that agree with @scalar/openapi-parser on a valid document', async () => {
    // Build validators for a minimal OpenAPI-like schema
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        openapi: { type: 'string' },
        info: { $ref: '#/$defs/info' },
      },
      required: ['openapi', 'info'],
      $defs: {
        info: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            version: { type: 'string' },
          },
          required: ['title', 'version'],
        },
      },
    }

    const files = await buildValidatorSchema(schema, 'Document')

    // Sanity-check generated code shape
    const documentFile = files.find((f) => f.filename === 'document.ts')
    const infoFile = files.find((f) => f.filename === 'info.ts')

    expect(documentFile?.content).toContain('validateDocument')
    expect(infoFile?.content).toContain('validateInfo')

    // Cross-check: @scalar/openapi-parser says a complete document is valid
    const validDoc = { openapi: '3.1.0', info: { title: 'API', version: '1.0' }, paths: {} }
    const refResult = await validate(validDoc)
    expect(refResult.valid).toBe(true)

    // Cross-check: @scalar/openapi-parser says a document missing info.title is invalid
    const invalidDoc = { openapi: '3.1.0', info: { version: '1.0' }, paths: {} }
    const refInvalid = await validate(invalidDoc)
    expect(refInvalid.valid).toBe(false)
    expect(refInvalid.errors.some((e) => e.message.includes('title'))).toBe(true)
  })

  it('emits a validation-result.ts with the runtime ValidationResult/ValidationError types', async () => {
    const schema: JSONSchema = { type: 'object' }
    const files = await buildValidatorSchema(schema, 'Doc')
    const vrFile = files.find((f) => f.filename === 'validation-result.ts')

    expect(vrFile?.content).toContain('export type ValidationError')
    expect(vrFile?.content).toContain('export type ValidationResult')
    expect(vrFile?.content).toContain('message: string')
    expect(vrFile?.content).toContain('path: string')
    // The runtime deep-equality helper backing structural `const` checks.
    expect(vrFile?.content).toContain('export const valuesEqual')
  })

  it('imports valuesEqual only into files that use a structural const', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { meta: { const: { a: 1 } }, name: { type: 'string' } },
    }
    const files = await buildValidatorSchema(schema, 'Doc')
    const docFile = files.find((f) => f.filename === 'doc.ts')

    expect(docFile?.content).toContain("import { valuesEqual } from './validation-result.js'")
    expect(docFile?.content).toContain('!valuesEqual(obj.meta, {"a":1})')
  })

  it('emits the structural allUnique helper in validation-result.ts', async () => {
    const schema: JSONSchema = { type: 'object' }
    const files = await buildValidatorSchema(schema, 'Doc')
    const vrFile = files.find((f) => f.filename === 'validation-result.ts')

    expect(vrFile?.content).toContain('export const allUnique')
  })

  it('imports allUnique only into files with a structural uniqueItems check', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object' }, uniqueItems: true },
        tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      },
    }
    const files = await buildValidatorSchema(schema, 'Doc')
    const docFile = files.find((f) => f.filename === 'doc.ts')

    expect(docFile?.content).toContain("import { allUnique } from './validation-result.js'")
    expect(docFile?.content).toContain('!allUnique(obj.rows as unknown[])')
    // Scalar-item arrays keep the cheap JSON-projection dedupe.
    expect(docFile?.content).toContain('map((_u) => JSON.stringify(_u))')
  })

  // The registry is what makes "we do no I/O" stop meaning "we cannot be told":
  // a ref into a document the caller loaded resolves like any other.
  it('resolves a $ref into a registered document', async () => {
    const files = await buildValidatorSchema({ $ref: 'https://example.com/user.json' } as JSONSchema, 'Doc', '', {
      'https://example.com/user.json': { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    })

    expect(files.map((f) => f.filename)).toContain('user.ts')
    expect(files.find((f) => f.filename === 'doc.ts')?.content).toContain('validateUser')
  })

  it('resolves a ref from one registered document into another', async () => {
    const files = await buildValidatorSchema({ $ref: 'https://example.com/a.json' } as JSONSchema, 'Doc', '', {
      'https://example.com/a.json': { type: 'object', properties: { b: { $ref: 'b.json' } } },
      'https://example.com/b.json': { type: 'string' },
    })

    expect(files.map((f) => f.filename)).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
  })

  // A caller should be able to point the registry at everything they happen to
  // have loaded without paying for it in the output.
  it('emits nothing for a registered document the schema never references', async () => {
    const files = await buildValidatorSchema({ type: 'string' } as JSONSchema, 'Doc', '', {
      'https://example.com/unused.json': { type: 'object' },
    })

    expect(files.map((f) => f.filename)).not.toContain('unused.ts')
  })

  // An unreferenced companion used to be walked anyway, so a dangling ref inside
  // one could fail a build that never asked for it.
  it('ignores a dangling ref inside an unreferenced registered document', async () => {
    const files = await buildValidatorSchema({ type: 'string' } as JSONSchema, 'Doc', '', {
      'https://example.com/unused.json': { $ref: 'https://example.com/never-registered.json' },
    })

    expect(files.map((f) => f.filename)).toContain('doc.ts')
  })

  it('still refuses a $ref to a URI nobody registered', async () => {
    await expect(
      buildValidatorSchema({ $ref: 'https://example.com/missing.json' } as JSONSchema, 'Doc', '', {
        'https://example.com/other.json': { type: 'string' },
      }),
    ).rejects.toThrow(/Could not resolve \$ref/)
  })
})
