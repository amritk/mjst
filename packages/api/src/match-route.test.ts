import { describe, expect, it } from 'vitest'

import { allowedMethods, matchRoute } from './match-route'
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
  headers: undefined,
  cookies: undefined,
  responses: undefined,
  rawContentTypes: undefined,
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
  return { staticRoutes, dynamicRoutes, methods: [...new Set(routes.map((compiled) => compiled.method))] }
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

  it('captures the remaining segments for a greedy tail', () => {
    const files = route('GET', '/files/{path+}')
    expect(matchRoute(table([files]), 'GET', '/files/a')?.params).toEqual({ path: 'a' })
    expect(matchRoute(table([files]), 'GET', '/files/a/b/c')?.params).toEqual({ path: 'a/b/c' })
    // Greedy means one or more — the bare prefix is not a match.
    expect(matchRoute(table([files]), 'GET', '/files')).toBeUndefined()
  })

  it('percent-decodes greedy captures per segment before rejoining', () => {
    const files = route('GET', '/files/{path+}')
    const match = matchRoute(table([files]), 'GET', '/files/dir%20one/file%2Ename.txt')
    expect(match?.params).toEqual({ path: 'dir one/file.name.txt' })
  })

  it('checks literal segments before a greedy tail', () => {
    const files = route('GET', '/files/v2/{path+}')
    expect(matchRoute(table([files]), 'GET', '/files/v1/a/b')).toBeUndefined()
    expect(matchRoute(table([files]), 'GET', '/files/v2/a/b')?.params).toEqual({ path: 'a/b' })
  })

  it('captures several parameters in one path', () => {
    const post = route('GET', '/users/{userId}/posts/{postId}')
    expect(matchRoute(table([post]), 'GET', '/users/7/posts/9')?.params).toEqual({ userId: '7', postId: '9' })
  })

  // Registration order decides which of two overlapping routes wins, and the
  // matcher buckets candidates by their first segment — so a literal-first and
  // a parameter-first route that both match must still be tried in the order
  // they were registered, not in bucket order.
  it('prefers whichever of a literal-first and parameter-first route was registered first', () => {
    const tenant = route('GET', '/{tenant}/settings')
    const admin = route('GET', '/admin/{page}')
    expect(matchRoute(table([tenant, admin]), 'GET', '/admin/settings')?.route).toBe(tenant)
    expect(matchRoute(table([admin, tenant]), 'GET', '/admin/settings')?.route).toBe(admin)
  })

  // Same rule across the greedy/fixed split: a greedy tail and a fixed pattern
  // of the same length both match a two-segment path.
  it('prefers whichever of a greedy tail and a fixed route was registered first', () => {
    const greedy = route('GET', '/files/{path+}')
    const fixed = route('GET', '/files/{dir}/{name}')
    expect(matchRoute(table([greedy, fixed]), 'GET', '/files/docs/a.txt')?.params).toEqual({ path: 'docs/a.txt' })
    expect(matchRoute(table([fixed, greedy]), 'GET', '/files/docs/a.txt')?.params).toEqual({
      dir: 'docs',
      name: 'a.txt',
    })
  })

  it('matches a greedy tail on a path longer than every fixed route', () => {
    const greedy = route('GET', '/files/{path+}')
    const fixed = route('GET', '/files/{dir}/{name}')
    expect(matchRoute(table([fixed, greedy]), 'GET', '/files/a/b/c/d/e')?.params).toEqual({ path: 'a/b/c/d/e' })
  })

  it('rejects a path longer than every route when nothing is greedy', () => {
    const user = route('GET', '/users/{id}')
    expect(matchRoute(table([user]), 'GET', '/users/1/2/3/4')).toBeUndefined()
  })

  it('lists the other methods serving a path, static and dynamic alike', () => {
    const routes = [route('GET', '/users/{id}'), route('DELETE', '/users/{id}'), route('POST', '/health')]
    expect(allowedMethods(table(routes), '/users/7', 'PUT').sort()).toEqual(['DELETE', 'GET'])
    expect(allowedMethods(table(routes), '/health', 'GET')).toEqual(['POST'])
  })

  it('leaves the requesting method out of the allow list and normalizes the path', () => {
    const routes = [route('GET', '/users/{id}'), route('DELETE', '/users/{id}')]
    expect(allowedMethods(table(routes), '/users/7/', 'GET')).toEqual(['DELETE'])
  })

  it('returns no allowed methods for a path nothing serves', () => {
    expect(allowedMethods(table([route('GET', '/users/{id}')]), '/nothing/7', 'GET')).toEqual([])
  })
})
