import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { routeImplementer } from './route-implementer'
import type { ApiRequest } from './types'

type AppContext = { readonly userName: string }

const getProfile = defineContract({
  method: 'get',
  path: '/profile',
  responses: {
    200: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
})

const request = (): ApiRequest => ({
  method: 'GET',
  path: '/profile',
  searchParams: () => new URLSearchParams(),
  header: () => undefined,
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

describe('route-implementer', () => {
  it('types the handler context from the app context parameter', async () => {
    const implementAppRoute = routeImplementer<AppContext>()
    const route = implementAppRoute(getProfile, ({ context }) => ({
      // context.userName is a string here — no cast needed.
      status: 200,
      body: { name: context.userName },
    }))
    const api = createApi({ routes: [route], context: () => ({ userName: 'Ada' }) })
    expect(await api.handle(request())).toEqual({ status: 200, body: { name: 'Ada' } })
  })

  it('keeps the contract reply checking of the plain implementer', () => {
    const implementAppRoute = routeImplementer<AppContext>()
    implementAppRoute(
      getProfile,
      // @ts-expect-error — 418 is not a declared status
      () => ({ status: 418 }),
    )
    expect(true).toBe(true)
  })
})
