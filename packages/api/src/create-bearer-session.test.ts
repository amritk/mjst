import { describe, expect, it } from 'vitest'

import { type BearerTokenStorage, createBearerSession } from './create-bearer-session'

/** An in-memory stand-in for `expo-secure-store`, async like the real thing. */
const memoryStorage = (initial?: string): BearerTokenStorage & { value: () => string | undefined } => {
  let stored = initial
  return {
    get: async () => stored,
    set: async (token) => {
      stored = token
    },
    clear: async () => {
      stored = undefined
    },
    value: () => stored,
  }
}

const authOf = (init: RequestInit): string | null => new Headers(init.headers).get('authorization')

describe('create-bearer-session', () => {
  it('attaches the stored token to every request', async () => {
    const sent: (string | null)[] = []
    const session = createBearerSession({
      storage: memoryStorage('stored-token'),
      fetch: async (_url, init) => {
        sent.push(authOf(init))
        return new Response(null, { status: 200 })
      },
    })
    await session.fetch('https://api.test/a', { method: 'GET' })
    await session.fetch('https://api.test/b', { method: 'GET' })
    expect(sent).toEqual(['Bearer stored-token', 'Bearer stored-token'])
  })

  it('sends no authorization header when there is no session', async () => {
    let seen: string | null = 'unset'
    const session = createBearerSession({
      storage: memoryStorage(),
      fetch: async (_url, init) => {
        seen = authOf(init)
        return new Response(null, { status: 200 })
      },
    })
    await session.fetch('https://api.test/a', { method: 'GET' })
    expect(seen).toBeNull()
  })

  it('captures and persists a rotated token off the response', async () => {
    const storage = memoryStorage('old-token')
    const session = createBearerSession({
      storage,
      fetch: async () => new Response(null, { status: 200, headers: { 'set-auth-token': 'rotated-token' } }),
    })
    await session.fetch('https://api.test/a', { method: 'GET' })
    expect(storage.value()).toBe('rotated-token')
    expect(await session.token()).toBe('rotated-token')
  })

  it('ignores an empty token header rather than storing a blank session', async () => {
    const storage = memoryStorage('old-token')
    const session = createBearerSession({
      storage,
      fetch: async () => new Response(null, { status: 200, headers: { 'set-auth-token': '' } }),
    })
    await session.fetch('https://api.test/a', { method: 'GET' })
    expect(storage.value()).toBe('old-token')
  })

  it('reads storage once across a burst of requests at launch', async () => {
    let reads = 0
    const session = createBearerSession({
      storage: {
        get: async () => {
          reads += 1
          return 'stored-token'
        },
        set: () => undefined,
        clear: () => undefined,
      },
      fetch: async () => new Response(null, { status: 200 }),
    })
    await Promise.all([
      session.fetch('https://api.test/a', { method: 'GET' }),
      session.fetch('https://api.test/b', { method: 'GET' }),
      session.fetch('https://api.test/c', { method: 'GET' }),
    ])
    expect(reads).toBe(1)
  })

  it('clears the token and notifies on a 401 when no refresh is configured', async () => {
    const storage = memoryStorage('dead-token')
    let expired = 0
    const session = createBearerSession({
      storage,
      fetch: async () => new Response(null, { status: 401 }),
      onExpired: () => {
        expired += 1
      },
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    expect(response.status).toBe(401)
    expect(storage.value()).toBeUndefined()
    expect(expired).toBe(1)
  })

  it('replays the request under the new token after a refresh', async () => {
    const storage = memoryStorage('dead-token')
    const sent: (string | null)[] = []
    const session = createBearerSession({
      storage,
      refresh: async () => 'fresh-token',
      fetch: async (_url, init) => {
        const authorization = authOf(init)
        sent.push(authorization)
        // This is the assertion that matters: replaying the original init would
        // present the dead token again and 401 forever.
        return new Response(null, { status: authorization === 'Bearer fresh-token' ? 200 : 401 })
      },
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    expect(response.status).toBe(200)
    expect(sent).toEqual(['Bearer dead-token', 'Bearer fresh-token'])
    expect(storage.value()).toBe('fresh-token')
  })

  it('replaces rather than appends the stale authorization header on replay', async () => {
    const sent: (string | null)[] = []
    const session = createBearerSession({
      storage: memoryStorage('dead-token'),
      refresh: async () => 'fresh-token',
      fetch: async (_url, init) => {
        const authorization = authOf(init)
        sent.push(authorization)
        return new Response(null, { status: authorization === 'Bearer fresh-token' ? 200 : 401 })
      },
    })
    // The caller supplies its own headers, the way createClient does.
    await session.fetch('https://api.test/a', { method: 'GET', headers: { 'x-trace': 'abc' } })
    // One token on the replay, not a comma-joined pair — `Headers.set`, not `append`.
    expect(sent.at(-1)).toBe('Bearer fresh-token')
  })

  it('coalesces concurrent 401s into a single refresh', async () => {
    let refreshes = 0
    const session = createBearerSession({
      storage: memoryStorage('dead-token'),
      refresh: async () => {
        refreshes += 1
        return 'fresh-token'
      },
      fetch: async (_url, init) => new Response(null, { status: authOf(init) === 'Bearer fresh-token' ? 200 : 401 }),
    })
    const results = await Promise.all([
      session.fetch('https://api.test/a', { method: 'GET' }),
      session.fetch('https://api.test/b', { method: 'GET' }),
      session.fetch('https://api.test/c', { method: 'GET' }),
    ])
    expect(refreshes).toBe(1)
    expect(results.map((response) => response.status)).toEqual([200, 200, 200])
  })

  it('surrenders the session when refresh throws, reporting the error', async () => {
    const storage = memoryStorage('dead-token')
    const errors: unknown[] = []
    let expired = 0
    const session = createBearerSession({
      storage,
      refresh: async () => {
        throw new Error('network down')
      },
      fetch: async () => new Response(null, { status: 401 }),
      onExpired: () => {
        expired += 1
      },
      onError: (error) => errors.push(error),
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    // The caller still sees the real reply, so normal 401 handling runs.
    expect(response.status).toBe(401)
    expect(storage.value()).toBeUndefined()
    expect(expired).toBe(1)
    expect((errors[0] as Error).message).toBe('network down')
  })

  it('surrenders when refresh resolves to no token', async () => {
    const storage = memoryStorage('dead-token')
    const session = createBearerSession({
      storage,
      refresh: async () => undefined,
      fetch: async () => new Response(null, { status: 401 }),
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    expect(response.status).toBe(401)
    expect(storage.value()).toBeUndefined()
  })

  it('does not retry more than once when the replay is refused too', async () => {
    let calls = 0
    const session = createBearerSession({
      storage: memoryStorage('dead-token'),
      refresh: async () => 'fresh-token',
      fetch: async () => {
        calls += 1
        return new Response(null, { status: 401 })
      },
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    expect(response.status).toBe(401)
    expect(calls).toBe(2)
    expect(await session.token()).toBeUndefined()
  })

  it('keeps serving requests when the token cannot be persisted', async () => {
    const errors: unknown[] = []
    const session = createBearerSession({
      storage: {
        get: async () => undefined,
        set: async () => {
          throw new Error('keychain locked')
        },
        clear: () => undefined,
      },
      fetch: async () => new Response(null, { status: 200, headers: { 'set-auth-token': 'issued-token' } }),
      onError: (error) => errors.push(error),
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    expect(response.status).toBe(200)
    expect((errors[0] as Error).message).toBe('keychain locked')
    // Durability is lost, but the token still works for the rest of this run.
    expect(await session.token()).toBe('issued-token')
  })

  it('treats an unreadable store as a signed-out client', async () => {
    const errors: unknown[] = []
    const session = createBearerSession({
      storage: {
        get: async () => {
          throw new Error('keychain locked')
        },
        set: () => undefined,
        clear: () => undefined,
      },
      fetch: async (_url, init) => new Response(authOf(init) ?? 'none', { status: 200 }),
      onError: (error) => errors.push(error),
    })
    const response = await session.fetch('https://api.test/a', { method: 'GET' })
    expect(await response.text()).toBe('none')
    expect(errors).toHaveLength(1)
  })

  it('honours a custom token header, auth scheme, and expiry test', async () => {
    const storage = memoryStorage('stored-token')
    let seen: string | null = null
    const session = createBearerSession({
      storage,
      tokenHeader: 'x-session-token',
      header: (token) => ({ 'x-api-key': token }),
      isExpired: (response) => response.status === 419,
      fetch: async (_url, init) => {
        seen = new Headers(init.headers).get('x-api-key')
        return new Response(null, { status: 200, headers: { 'x-session-token': 'rotated-token' } })
      },
    })
    await session.fetch('https://api.test/a', { method: 'GET' })
    expect(seen).toBe('stored-token')
    expect(storage.value()).toBe('rotated-token')
  })

  it('stores a token handed in from a sign-in, and drops it on sign-out', async () => {
    const storage = memoryStorage()
    const session = createBearerSession({
      storage,
      fetch: async () => new Response(null, { status: 200 }),
    })
    await session.set('from-magic-link')
    expect(storage.value()).toBe('from-magic-link')
    expect(await session.token()).toBe('from-magic-link')

    await session.clear()
    expect(storage.value()).toBeUndefined()
    expect(await session.token()).toBeUndefined()
  })
})
