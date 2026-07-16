import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import type { ApiRequest, ValidationFailureBody } from './types'

/**
 * Builds the framework-neutral request an adapter would produce, so the whole
 * pipeline is exercised without any HTTP transport.
 */
const request = (method: string, path: string, options: { search?: string; body?: unknown } = {}): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(options.search ?? ''),
  header: () => undefined,
  readBody: () =>
    'body' in options ? Promise.resolve(options.body) : Promise.reject(new SyntaxError('Unexpected end of input')),
})

const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  responses: {
    200: {
      body: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
    404: {},
  },
  handler: ({ params }) => (params.id === 1 ? { status: 200, body: { id: 1, name: 'Ada' } } : { status: 404 }),
})

const listUsers = defineRoute({
  method: 'get',
  path: '/users',
  request: {
    query: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  responses: {
    200: { body: { type: 'object', properties: { limit: {}, tags: {} } } },
  },
  handler: ({ query }) => ({ status: 200, body: { limit: query.limit, tags: query.tags } }),
})

const createUser = defineRoute({
  method: 'post',
  path: '/users',
  request: {
    body: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'] },
  },
  responses: {
    201: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
  handler: ({ body }) => ({ status: 201, body: { name: body.name } }),
})

describe('create-api', () => {
  it('handles a request end-to-end with coerced, validated path params', async () => {
    const api = createApi({ routes: [getUser] })
    const response = await api.handle(request('GET', '/users/1'))
    expect(response).toEqual({ status: 200, body: { id: 1, name: 'Ada' } })
  })

  it('lets the handler pick any declared status', async () => {
    const api = createApi({ routes: [getUser] })
    const response = await api.handle(request('GET', '/users/2'))
    expect(response.status).toBe(404)
    expect(response.body).toBeUndefined()
  })

  it('rejects invalid path params with the collected errors', async () => {
    const api = createApi({ routes: [getUser] })
    const response = await api.handle(request('GET', '/users/abc'))
    expect(response.status).toBe(400)
    const body = response.body as ValidationFailureBody
    expect(body.error).toBe('validation_failed')
    expect(body.source).toBe('params')
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it('coerces and validates query parameters', async () => {
    const api = createApi({ routes: [listUsers] })
    const response = await api.handle(request('GET', '/users', { search: 'limit=5&tags=a&tags=b' }))
    expect(response).toEqual({ status: 200, body: { limit: 5, tags: ['a', 'b'] } })
  })

  it('rejects query values that violate the schema', async () => {
    const api = createApi({ routes: [listUsers] })
    const response = await api.handle(request('GET', '/users', { search: 'limit=0' }))
    expect(response.status).toBe(400)
    expect((response.body as ValidationFailureBody).source).toBe('query')
  })

  it('validates the request body', async () => {
    const api = createApi({ routes: [createUser] })
    const created = await api.handle(request('POST', '/users', { body: { name: 'Grace' } }))
    expect(created).toEqual({ status: 201, body: { name: 'Grace' } })

    const rejected = await api.handle(request('POST', '/users', { body: { name: '' } }))
    expect(rejected.status).toBe(400)
    expect((rejected.body as ValidationFailureBody).source).toBe('body')
  })

  it('answers 400 invalid_json when the body cannot be parsed', async () => {
    const api = createApi({ routes: [createUser] })
    const response = await api.handle(request('POST', '/users'))
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'invalid_json' })
  })

  it('answers 404 for unknown paths and methods', async () => {
    const api = createApi({ routes: [getUser] })
    expect((await api.handle(request('GET', '/nope'))).status).toBe(404)
    expect((await api.handle(request('DELETE', '/users/1'))).status).toBe(404)
  })

  it('serves the OpenAPI document at the default path', async () => {
    const api = createApi({ routes: [getUser], info: { title: 'Users', version: '1.0.0' } })
    const response = await api.handle(request('GET', '/openapi.json'))
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ openapi: '3.1.0', info: { title: 'Users', version: '1.0.0' } })
  })

  it('serves the OpenAPI document at a custom path and not at the default', async () => {
    const api = createApi({ routes: [getUser], openApiPath: '/docs/spec.json' })
    expect((await api.handle(request('GET', '/docs/spec.json'))).status).toBe(200)
    expect((await api.handle(request('GET', '/openapi.json'))).status).toBe(404)
  })

  it('disables OpenAPI serving with openApiPath: false', async () => {
    const api = createApi({ routes: [getUser], openApiPath: false })
    expect((await api.handle(request('GET', '/openapi.json'))).status).toBe(404)
    expect(api.matches('GET', '/openapi.json')).toBe(false)
  })

  it('reports matches for routes and the OpenAPI path', () => {
    const api = createApi({ routes: [getUser] })
    expect(api.matches('GET', '/users/42')).toBe(true)
    expect(api.matches('get', '/users/42')).toBe(true)
    expect(api.matches('GET', '/openapi.json')).toBe(true)
    expect(api.matches('POST', '/users/42')).toBe(false)
  })

  it('throws on duplicate static routes at startup', () => {
    expect(() => createApi({ routes: [listUsers, listUsers] })).toThrow(/Duplicate route/)
  })

  it('throws on dynamic routes with the same shape, whatever the parameter names', () => {
    const clone = defineRoute({
      method: 'get',
      path: '/users/{userId}',
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    expect(() => createApi({ routes: [getUser, clone] })).toThrow(/Duplicate route/)
  })

  it('turns a thrown handler error into a bare 500 by default', async () => {
    const throwing = defineRoute({
      method: 'get',
      path: '/boom',
      responses: { 200: {} },
      handler: () => {
        throw new Error('secret detail')
      },
    })
    const api = createApi({ routes: [throwing] })
    const response = await api.handle(request('GET', '/boom'))
    expect(response.status).toBe(500)
    // The default error response must not leak the thrown message.
    expect(JSON.stringify(response.body)).not.toContain('secret detail')
  })

  it('routes thrown handler errors through onError when provided', async () => {
    const throwing = defineRoute({
      method: 'get',
      path: '/boom',
      responses: { 200: {} },
      handler: () => {
        throw new Error('nope')
      },
    })
    const api = createApi({
      routes: [throwing],
      onError: (error) => ({ status: 503, body: { message: error instanceof Error ? error.message : 'unknown' } }),
    })
    expect(await api.handle(request('GET', '/boom'))).toEqual({ status: 503, body: { message: 'nope' } })
  })

  it('flags contract-breaking reply bodies when validateResponses is on', async () => {
    const lying = defineRoute({
      method: 'get',
      path: '/liar',
      responses: { 200: { body: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      // The cast simulates a handler whose runtime value drifts from its
      // declared contract — exactly what response validation exists to catch.
      handler: () => ({ status: 200, body: { id: 'not-a-number' } }) as never,
    })
    const api = createApi({ routes: [lying], validateResponses: true })
    const response = await api.handle(request('GET', '/liar'))
    expect(response.status).toBe(500)
    expect(response.body).toMatchObject({ error: 'invalid_response', status: 200 })
  })

  it('flags undeclared reply statuses when validateResponses is on', async () => {
    const offContract = defineRoute({
      method: 'get',
      path: '/surprise',
      responses: { 200: {} },
      handler: () => ({ status: 302 }) as never,
    })
    const api = createApi({ routes: [offContract], validateResponses: true })
    const response = await api.handle(request('GET', '/surprise'))
    expect(response.status).toBe(500)
    expect(response.body).toMatchObject({ error: 'invalid_response', status: 302 })
  })

  it('skips response validation by default', async () => {
    const lying = defineRoute({
      method: 'get',
      path: '/liar',
      responses: { 200: { body: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      handler: () => ({ status: 200, body: { id: 'not-a-number' } }) as never,
    })
    const api = createApi({ routes: [lying] })
    expect((await api.handle(request('GET', '/liar'))).status).toBe(200)
  })

  it('passes reply headers through', async () => {
    const withHeaders = defineRoute({
      method: 'get',
      path: '/cached',
      responses: { 200: {} },
      handler: () => ({ status: 200, headers: { 'cache-control': 'max-age=60' } }),
    })
    const api = createApi({ routes: [withHeaders] })
    const response = await api.handle(request('GET', '/cached'))
    expect(response.headers).toEqual({ 'cache-control': 'max-age=60' })
  })

  it('accepts a custom validator compiler', async () => {
    const compiled: unknown[] = []
    const api = createApi({
      routes: [createUser],
      compile: (schema) => {
        compiled.push(schema)
        // An intentionally accept-everything engine proves the hook is used.
        return { guard: (_input): _input is never => true, collect: () => true }
      },
    })
    const response = await api.handle(request('POST', '/users', { body: { name: 'ok' } }))
    expect(response.status).toBe(201)
    expect(compiled.length).toBeGreaterThan(0)
  })
})
