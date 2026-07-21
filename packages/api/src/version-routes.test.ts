import { describe, expect, it } from 'vitest'

import { defineRoute } from './define-route'
import type { AnyRouteContract } from './types'
import { versionRoutes } from './version-routes'

const listUsers = defineRoute({
  method: 'get',
  path: '/users',
  responses: { 200: {} },
  handler: () => ({ status: 200 }),
}) as AnyRouteContract

describe('version-routes', () => {
  it('prefixes each route path', () => {
    const [route] = versionRoutes('/v1', [listUsers])
    expect(route?.path).toBe('/v1/users')
  })

  it('normalizes a prefix without a leading slash', () => {
    const [route] = versionRoutes('v2', [listUsers])
    expect(route?.path).toBe('/v2/users')
  })

  it('strips a trailing slash from the prefix', () => {
    const [route] = versionRoutes('/v1/', [listUsers])
    expect(route?.path).toBe('/v1/users')
  })

  it('does not mutate the original contracts', () => {
    versionRoutes('/v1', [listUsers])
    expect(listUsers.path).toBe('/users')
  })

  it('carries every other field through untouched', () => {
    const [route] = versionRoutes('/v1', [listUsers])
    expect(route?.method).toBe('get')
    expect(route?.handler).toBe(listUsers.handler)
    expect(route?.responses).toBe(listUsers.responses)
  })
})
