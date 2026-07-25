import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { denialStatusOf, requireContext } from './require-context'
import { routeImplementer } from './route-implementer'
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

type AppContext = { readonly session: { readonly role: string } | null }

const unauthorized = { status: 401, body: { error: 'unauthorized' } } as const
const forbidden = { status: 403, body: { error: 'forbidden' } } as const

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const

const profile = defineContract({
  method: 'get',
  path: '/profile',
  responses: {
    200: { body: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] } },
    401: { body: errorSchema },
    403: { body: errorSchema },
  },
})

// The reusable guards an app writes once and applies across routes.
const requireSession = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session !== null,
  unauthorized,
)
const requireAdmin = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session?.role === 'admin',
  forbidden,
)

const implementAppRoute = routeImplementer<AppContext>()

/** The context a reusable guard sees. The request slots stay empty — a guard gating on the session ignores them. */
const guardInput = (session: AppContext['session']): ContextGuardInput<AppContext> => ({
  params: undefined,
  query: undefined,
  body: undefined,
  headers: undefined,
  cookies: undefined,
  context: { session },
  request: request('/profile'),
})

describe('requireContext', () => {
  const api = (session: AppContext['session']) =>
    createApi({
      routes: [
        implementAppRoute(profile, {
          guards: [requireSession, requireAdmin],
          handler: (ctx) => ({ status: 200, body: { role: ctx.context.session?.role ?? 'unknown' } }),
        }),
      ],
      context: () => ({ session }),
    })

  it('passes when every predicate holds', async () => {
    expect(await api({ role: 'admin' }).handle(request('/profile'))).toEqual({ status: 200, body: { role: 'admin' } })
  })

  it('denies with the first failing guard reply', async () => {
    expect(await api(null).handle(request('/profile'))).toEqual({ status: 401, body: { error: 'unauthorized' } })
    // Session present but not admin: the second guard denies with its 403.
    expect(await api({ role: 'user' }).handle(request('/profile'))).toEqual({
      status: 403,
      body: { error: 'forbidden' },
    })
  })

  it('awaits an async predicate', async () => {
    const asyncSession = requireContext(async (ctx: ContextGuardInput<AppContext>) => {
      await Promise.resolve()
      return ctx.context.session !== null
    }, unauthorized)
    const route = implementAppRoute(profile, {
      guards: [asyncSession],
      handler: (ctx) => ({ status: 200, body: { role: ctx.context.session?.role ?? 'unknown' } }),
    })
    const built = createApi({ routes: [route], context: () => ({ session: null }) })
    expect((await built.handle(request('/profile'))).status).toBe(401)
  })

  it('stays synchronous when the predicate returns a plain boolean', () => {
    const guard = requireContext((ctx: ContextGuardInput<AppContext>) => ctx.context.session !== null, unauthorized)
    const result = guard({
      params: undefined,
      query: undefined,
      body: undefined,
      headers: undefined,
      cookies: undefined,
      context: { session: null },
      request: request('/profile'),
    })
    // No promise on the in-process path — the denial reply is returned directly.
    expect(result).toEqual(unauthorized)
  })

  it("receives the requirement's scopes as the predicate's second argument", () => {
    const seen: (readonly string[])[] = []
    const requireScope = requireContext((_ctx: ContextGuardInput<AppContext>, scopes) => {
      seen.push(scopes)
      return scopes.includes('billing:write')
    }, forbidden)
    expect(requireScope(guardInput({ role: 'user' }), ['billing:write'])).toBeUndefined()
    expect(requireScope(guardInput({ role: 'user' }), ['billing:read'])).toEqual(forbidden)
    expect(seen).toEqual([['billing:write'], ['billing:read']])
  })

  it('defaults the scopes to an empty list when the caller passes none', () => {
    // The route guard chain calls guards with the context alone, so a
    // scope-reading predicate must still see a list rather than `undefined`.
    const requireNoScopes = requireContext(
      (_ctx: ContextGuardInput<AppContext>, scopes) => scopes.length === 0,
      unauthorized,
    )
    expect(requireNoScopes(guardInput(null))).toBeUndefined()
  })

  it('resolves to undefined when an async predicate allows the request', async () => {
    const asyncSession = requireContext(async (ctx: ContextGuardInput<AppContext>) => {
      await Promise.resolve()
      return ctx.context.session !== null
    }, unauthorized)
    expect(await asyncSession(guardInput({ role: 'user' }))).toBeUndefined()
  })

  it('records the status each guard denies with', () => {
    // `secureRoutes` reads this to check the route documents the status, which
    // is the guarantee the type system cannot give a guard reached via a scheme.
    expect(denialStatusOf(requireSession)).toBe(401)
    expect(denialStatusOf(requireAdmin)).toBe(403)
  })

  it('records no denial status for a hand-written guard', () => {
    // A plain guard's denial can vary per request, so there is nothing to record.
    const handWritten = (ctx: ContextGuardInput<AppContext>) =>
      ctx.context.session === null ? unauthorized : undefined
    expect(denialStatusOf(handWritten)).toBeUndefined()
  })
})
