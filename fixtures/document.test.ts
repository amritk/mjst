import { describe, expect, it } from 'bun:test'

import { parseDocument } from './generate-parsers/document'

describe('document', () => {
  it('returns defaults when given a non-object', () => {
    const result = parseDocument(null)
    expect(result.openapi).toBe('')
    expect(result.info.title).toBe('')
    expect(result.info.version).toBe('')
  })

  it('returns defaults when given undefined', () => {
    const result = parseDocument(undefined)
    expect(result.openapi).toBe('')
  })

  it('coerces a numeric openapi version to a string', () => {
    const result = parseDocument({ openapi: 3, info: { title: 'API', version: '1' } })
    expect(result.openapi).toBe('3')
  })

  it('keeps a valid openapi semver string as-is', () => {
    const result = parseDocument({ openapi: '3.1.0', info: { title: 'API', version: '1' } })
    expect(result.openapi).toBe('3.1.0')
  })

  it('falls back to "1.0.0" when openapi field is missing', () => {
    const result = parseDocument({ info: { title: 'API', version: '1' } })
    expect(result.openapi).toBe('1.0.0')
  })

  it('coerces numeric info.title and info.version to strings', () => {
    const result = parseDocument({ openapi: '3.1.0', info: { title: 42, version: 99 } })
    expect(result.info.title).toBe('42')
    expect(result.info.version).toBe('99')
  })

  it('returns empty title and version when info is not an object', () => {
    const result = parseDocument({ openapi: '3.1.0', info: 'not-an-object' })
    expect(result.info.title).toBe('')
    expect(result.info.version).toBe('')
  })

  it('drops servers when the value is not an array', () => {
    const result = parseDocument({ openapi: '3.1.0', info: { title: 'API', version: '1' }, servers: 'bad' })
    expect(result.servers).toEqual([])
  })

  it('coerces server url from a number to a string', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      servers: [{ url: 8080 }],
    })
    expect(result.servers?.[0].url).toBe('8080')
  })

  it('drops a server entry that is not an object and replaces with default', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      servers: [null, { url: '/api' }],
    })
    expect(result.servers?.[0].url).toBe('')
    expect(result.servers?.[1].url).toBe('/api')
  })

  it('omits servers entirely when the field is absent', () => {
    const result = parseDocument({ openapi: '3.1.0', info: { title: 'API', version: '1' } })
    expect(result.servers).toBeUndefined()
  })

  it('coerces tags entries that are not objects', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      tags: ['not-an-object', { name: 'pets' }],
    })
    // non-object tag falls back to empty name
    expect(result.tags?.[0].name).toBe('')
    expect(result.tags?.[1].name).toBe('pets')
  })

  it('omits paths when the field is absent', () => {
    const result = parseDocument({ openapi: '3.1.0', info: { title: 'API', version: '1' } })
    expect(result.paths).toBeUndefined()
  })

  it('parses a minimal valid document without errors', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'My API', version: '0.1.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: { '200': { description: 'A list of pets' } },
          },
        },
      },
    })
    expect(result.openapi).toBe('3.1.0')
    expect(result.info.title).toBe('My API')
    expect(result.paths?.['/pets']?.get?.operationId).toBe('listPets')
  })

  it('coerces operationId from a number to a string', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: { '/x': { get: { operationId: 123 } } },
    })
    expect(result.paths?.['/x']?.get?.operationId).toBe('123')
  })

  it('handles a completely wrong-typed document', () => {
    const result = parseDocument({
      openapi: false,
      info: { title: true, version: [] },
      servers: 'not-an-array',
      paths: 'not-an-object',
      tags: 'not-an-array',
      security: 42,
    })
    expect(result.openapi).toBe('false')
    expect(result.info.title).toBe('true')
    expect(result.servers).toEqual([])
    expect(result.tags).toEqual([])
    expect(result.security).toEqual([])
  })

  it('preserves x- extension fields on the document', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      'x-internal-id': 'abc123',
    })
    expect((result as Record<string, unknown>)['x-internal-id']).toBe('abc123')
  })

  it('parsed document is a new object independent of the input', () => {
    const input = { openapi: '3.1.0', info: { title: 'My API', version: '1.0' } }
    const result = parseDocument(input)
    result.openapi = '4.0.0'
    expect(input.openapi).toBe('3.1.0')
  })

  it('parsed info object is independent of the input info', () => {
    const input = { openapi: '3.1.0', info: { title: 'My API', version: '1.0' } }
    const result = parseDocument(input)
    result.info.title = 'modified'
    expect(input.info.title).toBe('My API')
  })

  it('parsed info version is independent of the input info version', () => {
    const input = { openapi: '3.1.0', info: { title: 'My API', version: '1.0' } }
    const result = parseDocument(input)
    result.info.version = 'modified'
    expect(input.info.version).toBe('1.0')
  })

  it('modifying a parsed server does not affect the original servers array entry', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'My API', version: '1.0' },
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
    }
    const result = parseDocument(input)
    result.servers![0].url = 'https://modified.com'
    expect(input.servers![0].url).toBe('https://api.example.com')
  })

  it('pushing to the parsed servers array does not affect the original', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'My API', version: '1.0' },
      servers: [{ url: 'https://api.example.com' }],
    }
    const result = parseDocument(input)
    result.servers!.push({ url: 'https://new.example.com' })
    expect(input.servers!.length).toBe(1)
  })

  it('modifying a parsed tag does not affect the original tags', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'My API', version: '1.0' },
      tags: [{ name: 'pets', description: 'Pet operations' }],
    }
    const result = parseDocument(input)
    result.tags![0].name = 'modified'
    expect(input.tags![0].name).toBe('pets')
  })

  it('pushing to the parsed tags array does not affect the original', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'My API', version: '1.0' },
      tags: [{ name: 'pets' }],
    }
    const result = parseDocument(input)
    result.tags!.push({ name: 'new-tag' })
    expect(input.tags!.length).toBe(1)
  })
})
