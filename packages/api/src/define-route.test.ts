import { describe, expect, expectTypeOf, it } from 'vitest'

import { defineRoute } from './define-route'

describe('define-route', () => {
  it('returns the contract unchanged', () => {
    const route = defineRoute({
      method: 'get',
      path: '/ping',
      responses: { 204: {} },
      handler: () => ({ status: 204 }),
    })
    expect(route.method).toBe('get')
    expect(route.path).toBe('/ping')
  })

  it('types the handler context from the request schemas', () => {
    const route = defineRoute({
      method: 'post',
      path: '/users/{id}',
      request: {
        params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        query: { type: 'object', properties: { verbose: { type: 'boolean' } } },
        body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      responses: { 200: {} },
      handler: (context) => {
        expectTypeOf(context.params.id).toEqualTypeOf<number>()
        expectTypeOf(context.query.verbose).toEqualTypeOf<boolean | undefined>()
        expectTypeOf(context.body.name).toEqualTypeOf<string>()
        return { status: 200 }
      },
    })
    expect(route.path).toBe('/users/{id}')
  })

  it('types the headers slot from its schema', () => {
    defineRoute({
      method: 'get',
      path: '/tenant',
      request: {
        headers: {
          type: 'object',
          properties: { 'x-api-key': { type: 'string' }, 'x-retry-count': { type: 'integer' } },
          required: ['x-api-key'],
        },
      },
      responses: { 204: {} },
      handler: ({ headers }) => {
        expectTypeOf(headers['x-api-key']).toEqualTypeOf<string>()
        expectTypeOf(headers['x-retry-count']).toEqualTypeOf<number | undefined>()
        return { status: 204 }
      },
    })
  })

  it('types raw contentType statuses as streaming bodies', () => {
    defineRoute({
      method: 'post',
      path: '/chat',
      responses: { 200: { contentType: 'text/plain; charset=utf-8' }, 400: {} },
      handler: () => ({ status: 200, body: 'plain text is a valid streaming body' }),
    })

    defineRoute({
      method: 'post',
      path: '/chat-stream',
      responses: { 200: { contentType: 'text/event-stream' } },
      handler: () => ({ status: 200, body: new ReadableStream<Uint8Array>() }),
    })

    defineRoute({
      method: 'post',
      path: '/chat-wrong',
      responses: { 200: { contentType: 'text/plain' } },
      // @ts-expect-error — a raw status body must be a stream/text/bytes, not an object
      handler: () => ({ status: 200, body: { message: 'not raw' } }),
    })

    defineRoute({
      method: 'post',
      path: '/chat-missing',
      responses: { 200: { contentType: 'text/plain' } },
      // @ts-expect-error — a raw status requires a body
      handler: () => ({ status: 200 }),
    })
  })

  it('types undeclared slots as undefined', () => {
    defineRoute({
      method: 'get',
      path: '/bare',
      responses: { 204: {} },
      handler: (context) => {
        expectTypeOf(context.params).toEqualTypeOf<undefined>()
        expectTypeOf(context.query).toEqualTypeOf<undefined>()
        expectTypeOf(context.body).toEqualTypeOf<undefined>()
        return { status: 204 }
      },
    })
  })

  it('types the reply body from the matching response schema', () => {
    defineRoute({
      method: 'get',
      path: '/users/{id}',
      responses: {
        200: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        404: {},
      },
      handler: () => {
        const found = Math.random() > 0.5
        // Both declared variants type-check…
        return found ? { status: 200 as const, body: { name: 'Ada' } } : { status: 404 as const }
      },
    })

    defineRoute({
      method: 'get',
      path: '/strict',
      responses: { 200: { body: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } } },
      // @ts-expect-error — 500 is not a declared status
      handler: () => ({ status: 500 }),
    })

    defineRoute({
      method: 'get',
      path: '/strict-body',
      responses: { 200: { body: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } } },
      // @ts-expect-error — the body is missing its required property
      handler: () => ({ status: 200, body: {} }),
    })
  })

  it('rejects the wrong body for a status, per status', () => {
    const userSchema = {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    } as const

    // Discriminant narrowing needs no `as const` on the returned statuses:
    // contextual typing from the responses map keeps them literal.
    defineRoute({
      method: 'get',
      path: '/ok',
      responses: { 200: { body: userSchema }, 404: {} },
      handler: () => (Math.random() > 0.5 ? { status: 200, body: { id: 1, name: 'Ada' } } : { status: 404 }),
    })

    defineRoute({
      method: 'get',
      path: '/wrong-type',
      responses: { 200: { body: userSchema }, 404: {} },
      // @ts-expect-error — name must be a string, not a number
      handler: () => ({ status: 200, body: { id: 1, name: 42 } }),
    })

    defineRoute({
      method: 'get',
      path: '/body-on-empty',
      responses: { 200: { body: userSchema }, 404: {} },
      // @ts-expect-error — 404 declares no body, so returning one is rejected
      handler: () => ({ status: 404, body: { id: 1, name: 'Ada' } }),
    })

    defineRoute({
      method: 'get',
      path: '/async-wrong',
      responses: { 200: { body: userSchema } },
      // @ts-expect-error — the check reaches through Promise-returning handlers
      handler: async () => ({ status: 200, body: { id: 'not-a-number', name: 'Ada' } }),
    })
  })
})
