import { validate } from '@scalar/openapi-parser'
import { describe, expect, it } from 'bun:test'

import { validateDocument } from './validate-document'

describe('validate-document', () => {
  it('returns true for a valid OpenAPI 3.1 document', async () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'My API', version: '1.0' },
      paths: {},
    }

    const result = await validateDocument(document)

    expect(result).toBe(true)
  })

  it('returns true for a valid OpenAPI 3.0 document', async () => {
    const document = {
      openapi: '3.0.4',
      info: { title: 'My API', version: '1.0' },
      paths: {},
    }

    const result = await validateDocument(document)

    expect(result).toBe(true)
  })

  it('returns errors when required fields are missing', async () => {
    const document = {
      openapi: '3.1.0',
      info: { version: '1.0' },
      paths: {},
    }

    const result = await validateDocument(document)

    expect(result).not.toBe(true)
    if (result !== true) {
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]?.message).toContain('title')
    }
  })

  it('returns errors for an empty object', async () => {
    const result = await validateDocument({})

    expect(result).not.toBe(true)
    if (result !== true) {
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  it('matches @scalar/openapi-parser validate output for valid documents', async () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'My API', version: '1.0' },
      paths: {},
    }

    const [result, reference] = await Promise.all([validateDocument(document), validate(document)])

    expect(result).toBe(true)
    expect(reference.valid).toBe(true)
  })

  it('matches @scalar/openapi-parser validate output for invalid documents', async () => {
    const document = {
      openapi: '3.1.0',
      info: { version: '1.0' },
      paths: {},
    }

    const [result, reference] = await Promise.all([validateDocument(document), validate(document)])

    expect(result).not.toBe(true)
    expect(reference.valid).toBe(false)

    if (result !== true) {
      expect(result.errors.length).toBe(reference.errors.length)
      for (let i = 0; i < result.errors.length; i++) {
        expect(result.errors[i]?.message).toBe(reference.errors[i]?.message)
      }
    }
  })

  it('includes error paths when present', async () => {
    const document = {
      openapi: '3.1.0',
      info: { version: '1.0' },
      paths: {},
    }

    const result = await validateDocument(document)

    if (result !== true) {
      const errorsWithPath = result.errors.filter((e) => e.path !== undefined)
      expect(errorsWithPath.length).toBeGreaterThan(0)
      expect(errorsWithPath[0]?.path).toBe('/info')
    }
  })
})
