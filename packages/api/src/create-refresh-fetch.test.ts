import { describe, expect, it } from 'vitest'

import { createRefreshFetch } from './create-refresh-fetch'

describe('create-refresh-fetch', () => {
  it('refreshes and replays the request once on a 401', async () => {
    let authed = false
    let refreshes = 0
    const authFetch = createRefreshFetch({
      refresh: async () => {
        refreshes += 1
        authed = true
      },
      fetch: async () => new Response(authed ? 'ok' : 'no', { status: authed ? 200 : 401 }),
    })
    const response = await authFetch('https://api.test/thing', { method: 'GET' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(refreshes).toBe(1)
  })

  it('coalesces concurrent 401s into a single refresh', async () => {
    let authed = false
    let refreshes = 0
    const authFetch = createRefreshFetch({
      refresh: async () => {
        refreshes += 1
        authed = true
      },
      fetch: async () => new Response(null, { status: authed ? 200 : 401 }),
    })
    const results = await Promise.all([
      authFetch('https://api.test/a', { method: 'GET' }),
      authFetch('https://api.test/b', { method: 'GET' }),
      authFetch('https://api.test/c', { method: 'GET' }),
    ])
    // One shared renewal, and every request recovers.
    expect(refreshes).toBe(1)
    expect(results.map((response) => response.status)).toEqual([200, 200, 200])
  })

  it('returns the original response and reports when refresh fails', async () => {
    const errors: unknown[] = []
    const authFetch = createRefreshFetch({
      refresh: async () => {
        throw new Error('session gone')
      },
      fetch: async () => new Response('unauthorized', { status: 401 }),
      onRefreshError: (error) => errors.push(error),
    })
    const response = await authFetch('https://api.test/thing', { method: 'GET' })
    // The caller's normal 401 handling takes over; the failure is observed.
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('unauthorized')
    expect((errors[0] as Error).message).toBe('session gone')
  })

  it('passes successful responses through without refreshing', async () => {
    let refreshes = 0
    const authFetch = createRefreshFetch({
      refresh: async () => {
        refreshes += 1
      },
      fetch: async () => new Response('ok', { status: 200 }),
    })
    const response = await authFetch('https://api.test/thing', { method: 'GET' })
    expect(response.status).toBe(200)
    expect(refreshes).toBe(0)
  })

  it('retries at most once when the replay also fails', async () => {
    let refreshes = 0
    const authFetch = createRefreshFetch({
      refresh: async () => {
        refreshes += 1
      },
      // Never recovers: proves the wrapper does not loop.
      fetch: async () => new Response(null, { status: 401 }),
    })
    const response = await authFetch('https://api.test/thing', { method: 'GET' })
    expect(response.status).toBe(401)
    expect(refreshes).toBe(1)
  })

  it('honors a custom shouldRefresh predicate', async () => {
    let recovered = false
    const authFetch = createRefreshFetch({
      refresh: async () => {
        recovered = true
      },
      shouldRefresh: (response) => response.status === 419,
      fetch: async () => new Response(null, { status: recovered ? 200 : 419 }),
    })
    const response = await authFetch('https://api.test/thing', { method: 'GET' })
    expect(response.status).toBe(200)
  })
})
