import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { defineRoute } from './define-route'
import { implementRoute } from './implement-route'
import { routeImplementer } from './route-implementer'
import type { AnyRouteContract, ApiRequest } from './types'

const request = (path: string, headers: Record<string, string> = {}): ApiRequest => ({
  method: 'GET',
  path,
  searchParams: () => new URLSearchParams(),
  header: (name) => headers[name.toLowerCase()],
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

const unauthorized = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const

describe('route guards', () => {
  it('runs guards in order, first denial winning, and passes through to the handler', async () => {
    const calls: string[] = []
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: { type: 'object' } }, 401: { body: unauthorized } },
      guards: [
        () => {
          calls.push('g1')
          return undefined
        },
        () => {
          calls.push('g2')
          return undefined
        },
      ],
      handler: () => {
        calls.push('handler')
        return { status: 200, body: { ok: true } }
      },
    })
    const api = createApi({ routes: [route] })
    const response = await api.handle(request('/x'))
    expect(response).toEqual({ status: 200, body: { ok: true } })
    expect(calls).toEqual(['g1', 'g2', 'handler'])
  })

  it('short-circuits the handler when a guard denies, and skips later guards', async () => {
    const calls: string[] = []
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: { type: 'object' } }, 401: { body: unauthorized } },
      guards: [
        () => {
          calls.push('g1')
          return { status: 401, body: { error: 'unauthorized' } } as const
        },
        () => {
          calls.push('g2')
          return undefined
        },
      ],
      handler: () => {
        calls.push('handler')
        return { status: 200, body: { ok: true } }
      },
    })
    const api = createApi({ routes: [route] })
    const response = await api.handle(request('/x'))
    expect(response).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(calls).toEqual(['g1'])
  })

  it('awaits async guards', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: { type: 'object' } }, 401: { body: unauthorized } },
      guards: [
        async () => {
          await Promise.resolve()
          return { status: 401, body: { error: 'async-deny' } } as const
        },
      ],
      handler: () => ({ status: 200, body: { ok: true } }),
    })
    const api = createApi({ routes: [route] })
    expect(await api.handle(request('/x'))).toEqual({ status: 401, body: { error: 'async-deny' } })
  })

  it('gives guards the same app context the handler sees', async () => {
    type AppContext = { readonly session: { readonly user: string } | null }
    const implementAppRoute = routeImplementer<AppContext>()
    const getProfile = defineContract({
      method: 'get',
      path: '/profile',
      responses: {
        200: { body: { type: 'object', properties: { user: { type: 'string' } }, required: ['user'] } },
        401: { body: unauthorized },
      },
    })
    const route = implementAppRoute(getProfile, {
      guards: [(ctx) => (ctx.context.session === null ? { status: 401, body: { error: 'unauthorized' } } : undefined)],
      // The handler runs only past the guard, so the session is non-null here.
      handler: (ctx) => ({ status: 200, body: { user: ctx.context.session?.user ?? 'unknown' } }),
    })
    const api = createApi({
      routes: [route],
      context: ({ request }) => {
        const user = request.header('x-user')
        return { session: user !== undefined ? { user } : null }
      },
    })
    expect(await api.handle(request('/profile'))).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(await api.handle(request('/profile', { 'x-user': 'ada' }))).toEqual({ status: 200, body: { user: 'ada' } })
  })

  it('sends a thrown guard down the onError path, like a throwing handler', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: { type: 'object' } } },
      guards: [
        () => {
          throw new Error('guard blew up')
        },
      ],
      handler: () => ({ status: 200, body: { ok: true } }),
    })
    const api = createApi({
      routes: [route],
      onError: (error) => ({ status: 500, body: { error: error instanceof Error ? error.message : 'unknown' } }),
    })
    expect(await api.handle(request('/x'))).toEqual({ status: 500, body: { error: 'guard blew up' } })
  })

  it('validates a guard reply against the response contract like any other reply', async () => {
    // Erased so a body that violates the declared 401 schema gets past the type
    // checker — response validation is exactly the net for what types cannot see.
    const route: AnyRouteContract = {
      method: 'get',
      path: '/x',
      responses: { 200: { body: { type: 'object' } }, 401: { body: unauthorized } },
      guards: [() => ({ status: 401, body: { error: 42 } })],
      handler: () => ({ status: 200, body: { ok: true } }),
    }
    const api = createApi({ routes: [route], validateResponses: true })
    const response = await api.handle(request('/x'))
    expect(response.status).toBe(500)
    expect((response.body as { error: string }).error).toBe('invalid_response')
  })

  it('accepts guards through implementRoute for handler-free contracts', async () => {
    const getThing = defineContract({
      method: 'get',
      path: '/thing',
      responses: { 200: { body: { type: 'object' } }, 401: { body: unauthorized } },
    })
    const route = implementRoute(getThing, {
      guards: [
        (ctx) => (ctx.request.header('x-key') === 'secret' ? undefined : { status: 401, body: { error: 'no key' } }),
      ],
      handler: () => ({ status: 200, body: { ok: true } }),
    })
    const api = createApi({ routes: [route] })
    expect((await api.handle(request('/thing'))).status).toBe(401)
    expect(await api.handle(request('/thing', { 'x-key': 'secret' }))).toEqual({ status: 200, body: { ok: true } })
  })

  it('constrains guard replies to declared statuses at compile time', () => {
    const route = defineRoute({
      method: 'get',
      path: '/typed',
      responses: { 200: { body: { type: 'object' } }, 401: { body: unauthorized } },
      guards: [
        // A declared status with the right body shape is fine.
        () => ({ status: 401, body: { error: 'nope' } }),
        // Returning undefined (pass) is always allowed.
        () => undefined,
        // @ts-expect-error — 403 is not a declared status for this route
        () => ({ status: 403, body: { error: 'nope' } }),
      ],
      handler: () => ({ status: 200, body: { ok: true } }),
    })
    expect(route.guards).toHaveLength(3)
  })

  it('leaves an unguarded route paying nothing (guards field absent)', () => {
    const route = implementRoute(defineContract({ method: 'get', path: '/plain', responses: { 200: {} } }), () => ({
      status: 200,
    }))
    expect('guards' in route).toBe(false)
  })
})
