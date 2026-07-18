import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { implementRoute } from './implement-route'
import type { ApiRequest } from './types'

const getUser = defineContract({
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
})

const request = (path: string): ApiRequest => ({
  method: 'GET',
  path,
  searchParams: () => new URLSearchParams(),
  header: () => undefined,
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

describe('implement-route', () => {
  it('binds a handler typed from the contract and serves through createApi', async () => {
    const route = implementRoute(getUser, ({ params }) =>
      // params.id is a number here, and only declared statuses type-check.
      params.id === 1 ? { status: 200, body: { id: params.id, name: 'Ada' } } : { status: 404 },
    )
    const api = createApi({ routes: [route] })
    expect(await api.handle(request('/users/1'))).toEqual({ status: 200, body: { id: 1, name: 'Ada' } })
    expect((await api.handle(request('/users/2'))).status).toBe(404)
  })

  it('spreads the contract so the route carries every declared field', () => {
    const route = implementRoute(getUser, () => ({ status: 404 }))
    expect(route.method).toBe('get')
    expect(route.path).toBe('/users/{id}')
    expect(route.request).toBe(getUser.request)
    expect(route.responses).toBe(getUser.responses)
    expect(typeof route.handler).toBe('function')
    // The contract itself stays handler-free — the split is the point.
    expect('handler' in getUser).toBe(false)
  })

  it('rejects handlers that break the contract at compile time', () => {
    implementRoute(
      getUser,
      // @ts-expect-error — 500 is not a declared status
      () => ({ status: 500 }),
    )
    implementRoute(
      getUser,
      // @ts-expect-error — the 200 body is missing its required properties
      () => ({ status: 200, body: {} }),
    )
    expect(true).toBe(true)
  })
})
