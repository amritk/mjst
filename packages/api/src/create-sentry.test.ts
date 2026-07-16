import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { createSentry } from './create-sentry'
import { defineRoute } from './define-route'
import type { ApiRequest, ErrorCaptureInfo } from './index'

const boom = defineRoute({
  method: 'get',
  path: '/things/{id}',
  request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  responses: { 200: {} },
  handler: () => {
    throw new Error('database is on fire')
  },
})

const request = (path: string): ApiRequest => ({
  method: 'GET',
  path,
  searchParams: () => new URLSearchParams(),
  header: () => undefined,
  readBody: () => Promise.reject(new Error('no body')),
  readText: () => Promise.reject(new Error('no body')),
  readBytes: () => Promise.reject(new Error('no body')),
})

describe('create-sentry', () => {
  it('captures thrown handler errors with route, method, and platform context', async () => {
    const captured: Array<{ error: unknown; info: ErrorCaptureInfo }> = []
    const sentry = createSentry({ capture: (error, info) => captured.push({ error, info }) })
    const api = createApi({ routes: [boom], onError: sentry.onError })

    const response = await api.handle(request('/things/7'), { SENTRY_DSN: 'dsn' }, { waitUntil: () => {} })
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: 'internal_error' })

    expect(captured).toHaveLength(1)
    expect((captured[0]?.error as Error).message).toBe('database is on fire')
    // The route pattern, not the concrete URL — that is what groups issues.
    expect(captured[0]?.info.route).toBe('/things/{id}')
    expect(captured[0]?.info.method).toBe('GET')
    expect(captured[0]?.info.env).toEqual({ SENTRY_DSN: 'dsn' })
    expect(captured[0]?.info.executionContext).toBeDefined()
  })

  it('does not capture requests that fail validation instead of throwing', async () => {
    let captures = 0
    const sentry = createSentry({ capture: () => captures++ })
    const api = createApi({ routes: [boom], onError: sentry.onError })
    const response = await api.handle(request('/things/not-a-number'))
    expect(response.status).toBe(400)
    expect(captures).toBe(0)
  })

  it('uses the custom respond and survives a throwing capture', async () => {
    const sentry = createSentry({
      capture: () => {
        throw new Error('sentry outage')
      },
      respond: () => ({ status: 500, body: { error: 'oops', supportId: 'abc' } }),
    })
    const api = createApi({ routes: [boom], onError: sentry.onError })
    const response = await api.handle(request('/things/7'))
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: 'oops', supportId: 'abc' })
  })
})
