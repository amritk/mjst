import { describe, expect, expectTypeOf, it } from 'vitest'

import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { defineGuard, guardFactory, guardResponses } from './guard-bundle'
import { protectedRoute } from './protected-route'
import type { ApiRequest, ContextGuardInput } from './types'

const request = (path: string, headers: Record<string, string> = {}): ApiRequest => ({
  method: 'GET',
  path,
  searchParams: () => new URLSearchParams(),
  header: (name) => headers[name.toLowerCase()],
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const

type AppContext = { readonly session: { readonly role: string } | null }
const defineAppGuard = guardFactory<AppContext>()

const requireSession = defineAppGuard({
  responses: { 401: { body: errorSchema } },
  guard: (ctx) => (ctx.context.session === null ? { status: 401, body: { error: 'unauthorized' } } : undefined),
})
const requireAdmin = defineAppGuard({
  responses: { 403: { body: errorSchema } },
  guard: (ctx) => (ctx.context.session?.role === 'admin' ? undefined : { status: 403, body: { error: 'forbidden' } }),
})

const profileContract = {
  method: 'get',
  path: '/profile',
  responses: { 200: { body: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] } } },
} as const

describe('protectedRoute', () => {
  it('derives the guard status onto the route responses', () => {
    const route = protectedRoute(profileContract, [requireSession], () => ({ status: 200, body: { role: 'x' } }))
    // The 401 was never declared on the contract — it came from the guard.
    expect(Object.keys(route.responses).sort()).toEqual(['200', '401'])
    expect(route.responses[401]).toEqual({ body: errorSchema })
    expect(route.guards).toHaveLength(1)
    expect(typeof route.handler).toBe('function')
  })

  it('merges several guards, first-declared winning on a shared status', () => {
    const route = protectedRoute(profileContract, [requireSession, requireAdmin], () => ({
      status: 200,
      body: { role: 'x' },
    }))
    expect(Object.keys(route.responses).sort()).toEqual(['200', '401', '403'])
  })

  it('runs the derived guards through the pipeline like any other route', async () => {
    const route = protectedRoute(profileContract, [requireSession, requireAdmin], (ctx) => ({
      status: 200,
      body: { role: ctx.context.session?.role ?? 'unknown' },
    }))
    const api = (session: AppContext['session']) => createApi({ routes: [route], context: () => ({ session }) })

    expect(await api(null).handle(request('/profile'))).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(await api({ role: 'user' }).handle(request('/profile'))).toEqual({
      status: 403,
      body: { error: 'forbidden' },
    })
    expect(await api({ role: 'admin' }).handle(request('/profile'))).toEqual({ status: 200, body: { role: 'admin' } })
  })

  it('documents the derived status in the OpenAPI document', () => {
    const route = protectedRoute(profileContract, [requireSession], () => ({ status: 200, body: { role: 'x' } }))
    const api = createApi({ routes: [route], context: () => ({ session: null }), openApiPath: false })
    const doc = api.openApi()
    const operation = (doc.paths['/profile'] as { get: { responses: Record<string, unknown> } }).get
    // The guard's 401 rides into the document exactly like a hand-declared one.
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '401'])
  })

  it('validates the guard reply against the derived response contract', async () => {
    const badGuard = defineGuard({
      // Declares a 401 whose body is { error: string }, but denies with a number.
      responses: { 401: { body: errorSchema } },
      guard: (_ctx: ContextGuardInput<AppContext>) => ({ status: 401, body: { error: 42 } }) as never,
    })
    const route = protectedRoute(profileContract, [badGuard], () => ({ status: 200, body: { role: 'x' } }))
    const api = createApi({ routes: [route], context: () => ({ session: null }), validateResponses: true })
    const response = await api.handle(request('/profile'))
    expect(response.status).toBe(500)
    expect((response.body as { error: string }).error).toBe('invalid_response')
  })

  it('the route’s own declaration wins over a guard for a shared status', () => {
    const own = { body: { type: 'object', properties: { reason: { type: 'string' } } } } as const
    const contractWith401 = { ...profileContract, responses: { ...profileContract.responses, 401: own } } as const
    const route = protectedRoute(contractWith401, [requireSession], () => ({ status: 200, body: { role: 'x' } }))
    expect(route.responses[401]).toEqual(own)
  })

  it('types the derived status onto the route and its handler context', () => {
    const route = protectedRoute(profileContract, [requireSession, requireAdmin], (ctx) => {
      // Context is inferred from the guards — no annotation on the handler.
      expectTypeOf(ctx.context).toEqualTypeOf<AppContext>()
      return { status: 200, body: { role: 'x' } }
    })
    // The 401 and 403 the guards contribute are part of the route's response map.
    expectTypeOf<keyof (typeof route)['responses']>().toEqualTypeOf<200 | 401 | 403>()
  })

  it('rejects a guard that denies with a status it did not declare', () => {
    defineGuard({
      responses: { 401: { body: errorSchema } },
      // @ts-expect-error — 403 is not in this guard's declared responses
      guard: (_ctx: ContextGuardInput<AppContext>) => ({ status: 403, body: { error: 'forbidden' } }),
    })
  })

  it('guardResponses builds the fragment to spread into a browser-shared contract', () => {
    const fragment = guardResponses(requireSession, requireAdmin)
    expect(fragment).toEqual({ 401: { body: errorSchema }, 403: { body: errorSchema } })

    // Spread into defineContract so the native client is typed for the statuses.
    const contract = defineContract({
      method: 'get',
      path: '/profile',
      responses: { 200: { body: { type: 'object' } }, ...guardResponses(requireSession) },
    })
    expect(Object.keys(contract.responses).sort()).toEqual(['200', '401'])
  })
})
