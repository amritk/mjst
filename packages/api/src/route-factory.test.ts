import { describe, expect, expectTypeOf, it } from 'vitest'

import { createApi } from './create-api'
import { routeFactory } from './route-factory'
import type { ApiRequest } from './types'

type AppContext = { readonly db: { readonly name: string }; readonly userId: number | null }

const defineAppRoute = routeFactory<AppContext>()

const request = (method: string, path: string): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(),
  header: () => undefined,
  readBody: () => Promise.reject(new Error('no body')),
  readText: () => Promise.reject(new Error('no body')),
  readBytes: () => Promise.reject(new Error('no body')),
})

describe('route-factory', () => {
  it('types the handler context from the factory type parameter', () => {
    defineAppRoute({
      method: 'get',
      path: '/me',
      responses: { 200: {} },
      handler: ({ context }) => {
        expectTypeOf(context).toEqualTypeOf<AppContext>()
        return { status: 200 }
      },
    })
  })

  it('keeps schema-driven typing alongside the app context', () => {
    defineAppRoute({
      method: 'get',
      path: '/users/{id}',
      request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      responses: { 200: {} },
      handler: ({ params, context }) => {
        expectTypeOf(params.id).toEqualTypeOf<number>()
        expectTypeOf(context.userId).toEqualTypeOf<number | null>()
        return { status: 200 }
      },
    })
  })

  it('delivers the factory-built context, env, and executionContext at runtime', async () => {
    const seen: unknown[] = []
    const whoami = defineAppRoute({
      method: 'get',
      path: '/whoami',
      responses: { 200: { body: { type: 'object' } } },
      handler: ({ context }) => ({ status: 200, body: { db: context.db.name, userId: context.userId } }),
    })
    const api = createApi({
      routes: [whoami],
      context: ({ request: apiRequest, env, executionContext }) => {
        seen.push(apiRequest.path, env, executionContext)
        return { db: { name: 'main' }, userId: 7 } satisfies AppContext
      },
    })
    const response = await api.handle(request('GET', '/whoami'), { binding: true }, { waitUntil: 'stub' })
    expect(response).toEqual({ status: 200, body: { db: 'main', userId: 7 } })
    expect(seen).toEqual(['/whoami', { binding: true }, { waitUntil: 'stub' }])
  })

  it('turns a throwing context factory into a 500 without running the handler', async () => {
    let handlerRan = false
    const route = defineAppRoute({
      method: 'get',
      path: '/x',
      responses: { 200: {} },
      handler: () => {
        handlerRan = true
        return { status: 200 }
      },
    })
    const api = createApi({
      routes: [route],
      context: () => {
        throw new Error('no database')
      },
    })
    const response = await api.handle(request('GET', '/x'))
    expect(response.status).toBe(500)
    expect(handlerRan).toBe(false)
  })

  it('skips the context factory for requests that fail validation', async () => {
    let factoryRan = false
    const route = defineAppRoute({
      method: 'get',
      path: '/users/{id}',
      request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const api = createApi({
      routes: [route],
      context: () => {
        factoryRan = true
        return { db: { name: 'main' }, userId: null } satisfies AppContext
      },
    })
    const response = await api.handle(request('GET', '/users/abc'))
    expect(response.status).toBe(400)
    expect(factoryRan).toBe(false)
  })
})
