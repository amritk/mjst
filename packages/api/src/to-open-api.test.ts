import { describe, expect, it } from 'vitest'

import { defineRoute } from './define-route'
import { toOpenApi } from './to-open-api'

const info = { title: 'Test API', version: '1.2.3' }

const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  summary: 'Fetch a user',
  tags: ['users'],
  operationId: 'getUser',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: { type: 'object', properties: { verbose: { type: 'boolean' } }, required: [] },
  },
  responses: {
    200: {
      description: 'The user',
      body: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    404: {},
  },
  handler: () => ({ status: 404 }),
})

const createUser = defineRoute({
  method: 'post',
  path: '/users',
  request: {
    body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  responses: { 201: { body: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
  handler: () => ({ status: 201, body: { id: 1 } }),
})

describe('to-open-api', () => {
  it('emits a 3.1 document with the 2020-12 dialect', () => {
    const document = toOpenApi([getUser], info)
    expect(document.openapi).toBe('3.1.0')
    expect(document.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(document.info).toEqual(info)
  })

  it('keys operations by path and lowercase method', () => {
    const document = toOpenApi([getUser, createUser], info)
    expect(Object.keys(document.paths)).toEqual(['/users/{id}', '/users'])
    const pathItem = document.paths['/users/{id}'] as Record<string, unknown>
    expect(Object.keys(pathItem)).toEqual(['get'])
  })

  it('unrolls params and query schemas into parameter objects', () => {
    const document = toOpenApi([getUser], info)
    const operation = (document.paths['/users/{id}'] as Record<string, Record<string, unknown>>)['get']
    expect(operation?.['parameters']).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'verbose', in: 'query', required: false, schema: { type: 'boolean' } },
    ])
  })

  it('embeds the request body schema verbatim', () => {
    const document = toOpenApi([createUser], info)
    const operation = (document.paths['/users'] as Record<string, Record<string, unknown>>)['post']
    expect(operation?.['requestBody']).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    })
  })

  it('emits responses with descriptions, defaulting when omitted', () => {
    const document = toOpenApi([getUser], info)
    const operation = (document.paths['/users/{id}'] as Record<string, Record<string, unknown>>)['get']
    const responses = operation?.['responses'] as Record<string, Record<string, unknown>>
    expect(responses['200']?.['description']).toBe('The user')
    expect(responses['200']?.['content']).toEqual({
      'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
    })
    // A bodyless response still gets the spec-required description.
    expect(responses['404']).toEqual({ description: 'Status 404' })
  })

  it('carries summary, tags, and operationId through', () => {
    const document = toOpenApi([getUser], info)
    const operation = (document.paths['/users/{id}'] as Record<string, Record<string, unknown>>)['get']
    expect(operation?.['summary']).toBe('Fetch a user')
    expect(operation?.['tags']).toEqual(['users'])
    expect(operation?.['operationId']).toBe('getUser')
  })

  it('unrolls header schemas into in:header parameters', () => {
    const authed = defineRoute({
      method: 'get',
      path: '/tenant',
      request: {
        headers: {
          type: 'object',
          properties: { 'x-api-key': { type: 'string' }, 'x-trace-id': { type: 'string' } },
          required: ['x-api-key'],
        },
      },
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const document = toOpenApi([authed], info)
    const operation = (document.paths['/tenant'] as Record<string, Record<string, unknown>>)['get']
    expect(operation?.['parameters']).toEqual([
      { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'x-trace-id', in: 'header', required: false, schema: { type: 'string' } },
    ])
  })

  it('unrolls cookie schemas into in:cookie parameters', () => {
    const dashboard = defineRoute({
      method: 'get',
      path: '/dashboard',
      request: {
        cookies: {
          type: 'object',
          properties: { session: { type: 'string' } },
          required: ['session'],
        },
      },
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const document = toOpenApi([dashboard], info)
    const operation = (document.paths['/dashboard'] as Record<string, Record<string, unknown>>)['get']
    expect(operation?.['parameters']).toEqual([
      { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
    ])
  })

  it('documents raw statuses under their content type, without media parameters', () => {
    const chat = defineRoute({
      method: 'post',
      path: '/chat',
      responses: {
        200: { contentType: 'text/plain; charset=utf-8', description: 'Token stream' },
        204: { contentType: 'text/csv', body: { type: 'string' } },
      },
      handler: () => ({ status: 200, body: 'x' }),
    })
    const document = toOpenApi([chat], info)
    const operation = (document.paths['/chat'] as Record<string, Record<string, unknown>>)['post']
    const responses = operation?.['responses'] as Record<string, Record<string, unknown>>
    expect(responses['200']).toEqual({ description: 'Token stream', content: { 'text/plain': {} } })
    // A body schema on a raw status is documentation-only, but it does appear.
    expect(responses['204']).toEqual({
      description: 'Status 204',
      content: { 'text/csv': { schema: { type: 'string' } } },
    })
  })

  it('emits servers, securitySchemes, and the document-level security default', () => {
    const document = toOpenApi([getUser], info, {
      servers: [{ url: 'https://api.example.com', description: 'production' }],
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      security: [{ bearerAuth: [] }],
    })
    expect(document.servers).toEqual([{ url: 'https://api.example.com', description: 'production' }])
    expect(document.security).toEqual([{ bearerAuth: [] }])
    expect(document.components).toEqual({ securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } })
  })

  it('emits per-operation security and deprecated flags', () => {
    const legacy = defineRoute({
      method: 'get',
      path: '/legacy',
      deprecated: true,
      security: [{ apiKey: [] }],
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const document = toOpenApi([legacy, getUser], info)
    const operation = (document.paths['/legacy'] as Record<string, Record<string, unknown>>)['get']
    expect(operation?.['deprecated']).toBe(true)
    expect(operation?.['security']).toEqual([{ apiKey: [] }])
    const plain = (document.paths['/users/{id}'] as Record<string, Record<string, unknown>>)['get']
    expect(plain?.['deprecated']).toBeUndefined()
    expect(plain?.['security']).toBeUndefined()
  })

  it('documents declared response headers', () => {
    const limited = defineRoute({
      method: 'get',
      path: '/limited',
      responses: {
        200: {
          body: { type: 'object' },
          headers: { 'x-ratelimit-remaining': { type: 'integer' }, 'x-request-id': { type: 'string' } },
        },
      },
      handler: () => ({ status: 200, headers: { 'x-ratelimit-remaining': '9', 'x-request-id': 'a' }, body: {} }),
    })
    const document = toOpenApi([limited], info)
    const operation = (document.paths['/limited'] as Record<string, Record<string, unknown>>)['get']
    const responses = operation?.['responses'] as Record<string, Record<string, unknown>>
    expect(responses['200']?.['headers']).toEqual({
      'x-ratelimit-remaining': { schema: { type: 'integer' } },
      'x-request-id': { schema: { type: 'string' } },
    })
  })

  it('hoists titled schemas reused across contracts into components.schemas', () => {
    const user = { title: 'User', type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } as const
    const get = defineRoute({
      method: 'get',
      path: '/users/{id}',
      responses: { 200: { body: user } },
      handler: () => ({ status: 200, body: { id: 1 } }),
    })
    const create = defineRoute({
      method: 'post',
      path: '/users',
      request: { body: user },
      responses: { 201: { body: user } },
      handler: ({ body }) => ({ status: 201, body }),
    })
    const document = toOpenApi([get, create], info)
    expect((document.components as Record<string, unknown>)['schemas']).toEqual({ User: user })
    const ref = { $ref: '#/components/schemas/User' }
    const getOperation = (document.paths['/users/{id}'] as Record<string, Record<string, unknown>>)['get']
    const createOperation = (document.paths['/users'] as Record<string, Record<string, unknown>>)['post']
    expect(getOperation?.['responses']).toEqual({
      '200': { description: 'Status 200', content: { 'application/json': { schema: ref } } },
    })
    expect(createOperation?.['requestBody']).toEqual({
      required: true,
      content: { 'application/json': { schema: ref } },
    })
  })

  it('hoists distinct-but-identical titled schemas and leaves conflicts and singles inline', () => {
    const cloneA = { title: 'Thing', type: 'object', properties: { n: { type: 'integer' } } }
    const cloneB = { title: 'Thing', type: 'object', properties: { n: { type: 'integer' } } }
    const conflictA = { title: 'Clash', type: 'object' }
    const conflictB = { title: 'Clash', type: 'string' }
    const single = { title: 'Lonely', type: 'object' }
    const route = (path: string, body: unknown) =>
      defineRoute({
        method: 'post',
        path,
        request: { body },
        responses: { 201: {} },
        handler: () => ({ status: 201 }),
      })
    const document = toOpenApi(
      [route('/a', cloneA), route('/b', cloneB), route('/c', conflictA), route('/d', conflictB), route('/e', single)],
      info,
    )
    const schemas = (document.components as Record<string, unknown>)['schemas'] as Record<string, unknown>
    // JSON-identical clones share one component; a title claimed by different
    // shapes hoists nothing; a single titled use stays inline.
    expect(Object.keys(schemas)).toEqual(['Thing'])
    const bodySchema = (path: string) =>
      (
        (document.paths[path] as Record<string, Record<string, unknown>>)['post']?.['requestBody'] as {
          content: Record<string, { schema: unknown }>
        }
      ).content['application/json']?.schema
    expect(bodySchema('/a')).toEqual({ $ref: '#/components/schemas/Thing' })
    expect(bodySchema('/b')).toEqual({ $ref: '#/components/schemas/Thing' })
    expect(bodySchema('/c')).toBe(conflictA)
    expect(bodySchema('/d')).toBe(conflictB)
    expect(bodySchema('/e')).toBe(single)
  })

  it('sanitizes component keys derived from titles', () => {
    const shared = { title: 'User Profile (v2)', type: 'object' }
    const document = toOpenApi(
      [
        defineRoute({
          method: 'get',
          path: '/p1',
          responses: { 200: { body: shared } },
          handler: () => ({ status: 200, body: {} }),
        }),
        defineRoute({
          method: 'get',
          path: '/p2',
          responses: { 200: { body: shared } },
          handler: () => ({ status: 200, body: {} }),
        }),
      ],
      info,
    )
    const schemas = (document.components as Record<string, unknown>)['schemas'] as Record<string, unknown>
    expect(Object.keys(schemas)).toEqual(['User_Profile__v2_'])
  })
})
