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
})
