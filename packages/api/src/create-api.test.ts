import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import { payloadTooLargeError } from './payload-too-large'
import type { ApiRequest, ValidationFailureBody } from './types'

/**
 * Builds the framework-neutral request an adapter would produce, so the whole
 * pipeline is exercised without any HTTP transport.
 */
const request = (
  method: string,
  path: string,
  options: { search?: string; body?: unknown; headers?: Readonly<Record<string, string>> } = {},
): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(options.search ?? ''),
  header: (name) => options.headers?.[name],
  readBody: () =>
    'body' in options ? Promise.resolve(options.body) : Promise.reject(new SyntaxError('Unexpected end of input')),
  readText: () => Promise.resolve(JSON.stringify(options.body)),
  readBytes: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(options.body))),
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

  it('answers 404 for unknown paths and 405 for known paths under another method', async () => {
    const api = createApi({ routes: [getUser] })
    expect((await api.handle(request('GET', '/nope'))).status).toBe(404)
    expect((await api.handle(request('DELETE', '/users/1'))).status).toBe(405)
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

  it('validates declared request headers and hands them to the handler', async () => {
    const authed = defineRoute({
      method: 'get',
      path: '/tenant',
      request: {
        headers: {
          type: 'object',
          properties: { 'x-api-key': { type: 'string', minLength: 8 } },
          required: ['x-api-key'],
        },
      },
      responses: { 200: { body: { type: 'object', properties: { key: { type: 'string' } } } } },
      handler: ({ headers }) => ({ status: 200, body: { key: headers['x-api-key'] } }),
    })
    const api = createApi({ routes: [authed] })

    const ok = await api.handle(request('GET', '/tenant', { headers: { 'x-api-key': 'secret-key' } }))
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ key: 'secret-key' })

    const missing = await api.handle(request('GET', '/tenant'))
    expect(missing.status).toBe(400)
    expect((missing.body as ValidationFailureBody).source).toBe('headers')

    const tooShort = await api.handle(request('GET', '/tenant', { headers: { 'x-api-key': 'nope' } }))
    expect(tooShort.status).toBe(400)
  })

  it('replaces built-in error bodies via the errors formatters', async () => {
    const api = createApi({
      routes: [getUser],
      errors: {
        notFound: () => ({ status: 404, body: { error: 'no such thing' } }),
        validationFailed: (failure) => ({
          status: 400,
          body: { error: `bad ${failure.source}: ${failure.errors[0]?.message ?? 'invalid'}` },
        }),
      },
    })

    const missing = await api.handle(request('GET', '/nowhere'))
    expect(missing.body).toEqual({ error: 'no such thing' })

    const invalid = await api.handle(request('GET', '/users/not-a-number'))
    expect(invalid.status).toBe(400)
    expect((invalid.body as { error: string }).error).toMatch(/^bad params: /)
  })

  it('keeps built-in defaults for formatters that are not supplied', async () => {
    const api = createApi({
      routes: [getUser],
      errors: { notFound: () => ({ status: 404, body: { error: 'custom' } }) },
    })
    const invalid = await api.handle(request('GET', '/users/not-a-number'))
    expect((invalid.body as ValidationFailureBody).error).toBe('validation_failed')
  })

  it('tags raw statuses with their declared contentType', async () => {
    const stream = defineRoute({
      method: 'get',
      path: '/stream',
      responses: { 200: { contentType: 'text/plain; charset=utf-8' } },
      handler: () => ({ status: 200, body: 'raw text' }),
    })
    const api = createApi({ routes: [stream], validateResponses: true })
    const response = await api.handle(request('GET', '/stream'))
    expect(response.status).toBe(200)
    expect(response.contentType).toBe('text/plain; charset=utf-8')
    // The string body passes through even with response validation on — raw
    // statuses have no JSON value to validate.
    expect(response.body).toBe('raw text')
  })

  it('maps payload-too-large read errors to 413', async () => {
    const upload = defineRoute({
      method: 'post',
      path: '/upload',
      request: { body: { type: 'object' } },
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const api = createApi({ routes: [upload] })
    const tooLarge: ApiRequest = {
      ...request('POST', '/upload'),
      readBody: () => Promise.reject(payloadTooLargeError(16)),
    }
    const response = await api.handle(tooLarge)
    expect(response.status).toBe(413)
    expect(response.body).toEqual({ error: 'payload_too_large' })
  })

  it('answers 405 with a sorted allow header when only the method is wrong', async () => {
    const remove = defineRoute({
      method: 'delete',
      path: '/users/{id}',
      responses: { 204: {} },
      handler: () => ({ status: 204 }),
    })
    const api = createApi({ routes: [getUser, remove] })

    const response = await api.handle(request('PATCH', '/users/7'))
    expect(response.status).toBe(405)
    // HEAD is advertised because the GET route serves it implicitly.
    expect(response.headers).toEqual({ allow: 'DELETE, GET, HEAD' })
    expect(response.body).toEqual({ error: 'method_not_allowed' })

    // A path no method serves stays a 404.
    expect((await api.handle(request('PATCH', '/nowhere'))).status).toBe(404)
  })

  it('routes greedy tail parameters through validation to the handler', async () => {
    const files = defineRoute({
      method: 'get',
      path: '/files/{path+}',
      request: {
        params: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
      responses: { 200: { body: { type: 'object', properties: { path: {} } } } },
      handler: ({ params }) => ({ status: 200, body: { path: params.path } }),
    })
    const api = createApi({ routes: [files] })

    const nested = await api.handle(request('GET', '/files/docs/2026/report.pdf'))
    expect(nested.status).toBe(200)
    expect(nested.body).toEqual({ path: 'docs/2026/report.pdf' })

    // One or more segments: the bare prefix is a 404, not an empty capture.
    expect((await api.handle(request('GET', '/files'))).status).toBe(404)
  })

  it('rejects duplicate greedy patterns but allows greedy alongside single-segment params', () => {
    const greedy = (path: string) =>
      defineRoute({ method: 'get', path, responses: { 204: {} }, handler: () => ({ status: 204 }) })
    expect(() => createApi({ routes: [greedy('/files/{a+}'), greedy('/files/{b+}')] })).toThrow(/Duplicate route/)
    expect(() => createApi({ routes: [greedy('/files/{a+}'), greedy('/files/{b}')] })).not.toThrow()
  })

  it('runs the GET pipeline for HEAD requests (adapters discard the body)', async () => {
    const api = createApi({ routes: [getUser] })

    // The pipeline answers HEAD with GET's full reply — status, headers, and
    // body; discarding the body is the adapter's job.
    const found = await api.handle(request('HEAD', '/users/1'))
    expect(found.status).toBe(200)
    expect(found.body).toEqual({ id: 1, name: 'Ada' })

    const invalid = await api.handle(request('HEAD', '/users/abc'))
    expect(invalid.status).toBe(400)

    const openapi = await api.handle(request('HEAD', '/openapi.json'))
    expect(openapi.status).toBe(200)

    const missing = await api.handle(request('HEAD', '/missing'))
    expect(missing.status).toBe(404)
  })

  it('prefers an explicitly declared HEAD route over the GET fallback', async () => {
    const explicitHead = defineRoute({
      method: 'head',
      path: '/users/{id}',
      responses: { 204: {} },
      handler: () => ({ status: 204, headers: { 'x-explicit': 'head' } }),
    })
    const api = createApi({ routes: [getUser, explicitHead] })
    const response = await api.handle(request('HEAD', '/users/1'))
    expect(response.status).toBe(204)
    expect(response.headers).toEqual({ 'x-explicit': 'head' })
  })

  it('claims HEAD in matches() wherever GET matches', () => {
    const api = createApi({ routes: [getUser] })
    expect(api.matches('HEAD', '/users/1')).toBe(true)
    expect(api.matches('head', '/openapi.json')).toBe(true)
    expect(api.matches('HEAD', '/missing')).toBe(false)
  })

  it('lets the methodNotAllowed formatter reshape the 405', async () => {
    const api = createApi({
      routes: [getUser],
      errors: {
        methodNotAllowed: (allow) => ({ status: 405, body: { error: `try one of: ${allow.join('/')}` } }),
      },
    })
    const response = await api.handle(request('POST', '/users/7'))
    expect(response.status).toBe(405)
    expect(response.body).toEqual({ error: 'try one of: GET/HEAD' })
  })

  it('validates declared cookies and hands them to the handler', async () => {
    const dashboard = defineRoute({
      method: 'get',
      path: '/dashboard',
      request: {
        cookies: {
          type: 'object',
          properties: { session: { type: 'string', minLength: 4 }, visits: { type: 'integer' } },
          required: ['session'],
        },
      },
      responses: { 200: { body: { type: 'object' } } },
      handler: ({ cookies }) => ({ status: 200, body: { session: cookies.session, visits: cookies.visits ?? 0 } }),
    })
    const api = createApi({ routes: [dashboard] })

    const ok = await api.handle(
      request('GET', '/dashboard', { headers: { cookie: 'visits=3; session=abc123; _ga=tracker' } }),
    )
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ session: 'abc123', visits: 3 })

    const missing = await api.handle(request('GET', '/dashboard'))
    expect(missing.status).toBe(400)
    expect((missing.body as ValidationFailureBody).source).toBe('cookies')
  })

  it('maps payload-too-large errors thrown inside handlers to 413', async () => {
    const webhook = defineRoute({
      method: 'post',
      path: '/webhook',
      responses: { 200: {} },
      handler: async ({ request: incoming }) => {
        await incoming.readText()
        return { status: 200 }
      },
    })
    const api = createApi({
      routes: [webhook],
      errors: { payloadTooLarge: () => ({ status: 413, body: { error: 'too big, sorry' } }) },
    })
    const tooLarge: ApiRequest = {
      ...request('POST', '/webhook'),
      readText: () => Promise.reject(payloadTooLargeError(8)),
    }
    const response = await api.handle(tooLarge)
    expect(response.status).toBe(413)
    expect(response.body).toEqual({ error: 'too big, sorry' })
  })
})
