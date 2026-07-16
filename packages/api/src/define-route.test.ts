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
})
