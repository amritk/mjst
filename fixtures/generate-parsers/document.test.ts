import { describe, expect, it } from 'bun:test'
import { parseDocument } from './document'

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

  // --- components ---

  it('omits components when the field is absent', () => {
    const result = parseDocument({ openapi: '3.1.0', info: { title: 'API', version: '1' } })
    expect(result.components).toBeUndefined()
  })

  it('parses components.schemas with valid schema objects', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Pet: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
    })
    expect(result.components?.schemas?.Pet.type).toBe('object')
    expect((result.components?.schemas?.Pet as Record<string, unknown>).properties).toBeDefined()
  })

  it('drops a schema entry whose value is not an object', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: { schemas: { Bad: 'not-an-object' } },
    })
    // parseSchemaObject returns {} for non-objects, so the key still exists but is empty
    expect(result.components?.schemas?.Bad).toEqual({})
  })

  it('parses components.parameters with wrong in value falling back to "query"', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        parameters: {
          BadParam: { name: 'x', in: 'sideways', required: 'yes' },
        },
      },
    })
    const param = result.components?.parameters?.BadParam as Record<string, unknown>
    expect(param.in).toBe('query')
    // non-boolean required coerced via Boolean()
    expect(param.required).toBe(true)
  })

  it('parses components.responses with non-object description falling back to empty string', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        responses: {
          NotFound: { description: 404 },
        },
      },
    })
    const resp = result.components?.responses?.NotFound as Record<string, unknown>
    expect(resp.description).toBe('404')
  })

  it('returns empty content when components.responses entry is not an object', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: { responses: { Bad: null } },
    })
    const resp = result.components?.responses?.Bad as Record<string, unknown>
    expect(resp.description).toBe('')
  })

  it('parses components.requestBodies with non-boolean required coerced', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        requestBodies: {
          CreatePet: { content: {}, required: 1 },
        },
      },
    })
    const rb = result.components?.requestBodies?.CreatePet as Record<string, unknown>
    expect(rb.required).toBe(true)
  })

  it('falls back to empty content object when requestBody content is missing', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        requestBodies: { NoContent: {} },
      },
    })
    const rb = result.components?.requestBodies?.NoContent as Record<string, unknown>
    expect(rb.content).toEqual({})
  })

  // --- schema coercion deep-dives ---

  it('infers schema type "object" from properties keyword', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Inferred: { properties: { id: { type: 'string' } } },
        },
      },
    })
    expect(result.components?.schemas?.Inferred.type).toBe('object')
  })

  it('infers schema type "array" from items keyword', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          List: { items: { type: 'string' } },
        },
      },
    })
    expect(result.components?.schemas?.List.type).toBe('array')
  })

  it('infers schema type "string" from a known string format', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Email: { format: 'email' },
        },
      },
    })
    expect(result.components?.schemas?.Email.type).toBe('string')
  })

  it('drops invalid schema type values and does not set type', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Weird: { type: 'banana' },
        },
      },
    })
    // no valid type keyword and no inferrable keywords → type stays undefined
    expect(result.components?.schemas?.Weird.type).toBeUndefined()
  })

  it('strips non-string values from schema.required array', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Strict: {
            type: 'object',
            required: ['name', 42, null, 'age'],
            properties: { name: { type: 'string' }, age: { type: 'integer' } },
          },
        },
      },
    })
    const schema = result.components?.schemas?.Strict as Record<string, unknown>
    expect(schema.required).toEqual(['name', 'age'])
  })

  it('handles OpenAPI 3.0-style boolean exclusiveMaximum', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Score: { type: 'number', maximum: 100, exclusiveMaximum: true },
        },
      },
    })
    const schema = result.components?.schemas?.Score as Record<string, unknown>
    // boolean exclusiveMaximum is promoted to the value of maximum
    expect(schema.exclusiveMaximum).toBe(100)
  })

  it('preserves $ref schemas without parsing them', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      components: {
        schemas: {
          Ref: { $ref: '#/components/schemas/Pet' },
        },
      },
    })
    const schema = result.components?.schemas?.Ref as Record<string, unknown>
    expect(schema.$ref).toBe('#/components/schemas/Pet')
  })

  // --- operation deep-dives ---

  it('coerces operation deprecated from a non-boolean', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: { '/x': { get: { deprecated: 'true' } } },
    })
    expect(result.paths?.['/x']?.get?.deprecated).toBe(true)
  })

  it('drops operation tags when the value is not an array', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: { '/x': { get: { tags: 'pets' } } },
    })
    expect(result.paths?.['/x']?.get?.tags).toEqual([])
  })

  it('coerces response description from a number inside an operation', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/x': {
          post: {
            responses: { '201': { description: 201 } },
          },
        },
      },
    })
    const resp = result.paths?.['/x']?.post?.responses?.['201'] as Record<string, unknown>
    expect(resp.description).toBe('201')
  })

  it('falls back to empty response when a response entry is not an object', () => {
    const result = parseDocument({
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/x': {
          get: { responses: { '200': null } },
        },
      },
    })
    const resp = result.paths?.['/x']?.get?.responses?.['200'] as Record<string, unknown>
    expect(resp.description).toBe('')
  })
})
