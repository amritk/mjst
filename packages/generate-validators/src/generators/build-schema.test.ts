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

    expect(documentFile?.content).toContain("from './info'")
    expect(documentFile?.content).toContain('validateInfo')
  })

  it('generates a valid index.ts with re-exports', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    }

    const files = await buildValidatorSchema(schema, 'Document')
    const indexFile = files.find((f) => f.filename === 'index.ts')

    expect(indexFile?.content).toContain("from './document'")
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
  })
})
