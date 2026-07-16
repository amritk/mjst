import { describe, expect, it } from 'vitest'

import { matchRoute } from './match-route'
import { parsePathPattern } from './parse-path-pattern'
import type { AnyRouteContract, CompiledRoute, RouteTable } from './types'

/**
 * Builds a minimal compiled route — the matcher only reads method + segments,
 * so validators stay undefined and the contract is a stub.
 */
const route = (method: string, path: string): CompiledRoute => ({
  contract: { method: 'get', path, responses: {}, handler: () => ({ status: 204 }) } satisfies AnyRouteContract,
  method,
  segments: parsePathPattern(path),
  params: undefined,
  query: undefined,
  body: undefined,
  responses: undefined,
})

const table = (routes: readonly CompiledRoute[]): RouteTable => {
  const staticRoutes = new Map<string, CompiledRoute>()
  const dynamicRoutes = new Map<string, CompiledRoute[]>()
  for (const compiled of routes) {
    if (compiled.segments.every((segment) => typeof segment === 'string')) {
      staticRoutes.set(compiled.method + ' /' + compiled.segments.join('/'), compiled)
    } else {
      const list = dynamicRoutes.get(compiled.method) ?? []
      list.push(compiled)
      dynamicRoutes.set(compiled.method, list)
    }
  }
  return { staticRoutes, dynamicRoutes }
}

describe('match-route', () => {
  it('matches a static route', () => {
    const users = route('GET', '/users')
    const match = matchRoute(table([users]), 'GET', '/users')
    expect(match?.route).toBe(users)
    expect(match?.params).toEqual({})
  })

  it('matches the root path', () => {
    const root = route('GET', '/')
    expect(matchRoute(table([root]), 'GET', '/')?.route).toBe(root)
  })

  it('captures path parameters', () => {
    const user = route('GET', '/users/{id}')
    const match = matchRoute(table([user]), 'GET', '/users/42')
    expect(match?.params).toEqual({ id: '42' })
  })

  it('prefers a static route over a parameterized one', () => {
    const me = route('GET', '/users/me')
    const user = route('GET', '/users/{id}')
    expect(matchRoute(table([user, me]), 'GET', '/users/me')?.route).toBe(me)
  })

  it('treats a trailing slash as the same path', () => {
    const users = route('GET', '/users')
    expect(matchRoute(table([users]), 'GET', '/users/')?.route).toBe(users)
  })

  it('distinguishes methods', () => {
    const users = route('GET', '/users')
    expect(matchRoute(table([users]), 'POST', '/users')).toBeUndefined()
  })

  it('rejects paths with a different segment count', () => {
    const user = route('GET', '/users/{id}')
    expect(matchRoute(table([user]), 'GET', '/users')).toBeUndefined()
    expect(matchRoute(table([user]), 'GET', '/users/1/extra')).toBeUndefined()
  })

  it('percent-decodes captured parameters', () => {
    const user = route('GET', '/users/{email}')
    const match = matchRoute(table([user]), 'GET', '/users/ada%40example.com')
    expect(match?.params).toEqual({ email: 'ada@example.com' })
  })

  it('keeps malformed percent sequences raw instead of failing the match', () => {
    const user = route('GET', '/users/{id}')
    const match = matchRoute(table([user]), 'GET', '/users/%zz')
    expect(match?.params).toEqual({ id: '%zz' })
  })
})
