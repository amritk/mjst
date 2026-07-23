import { describe, expect, it, vi } from 'vitest'

import { createTokenRefresh } from './create-token-refresh'

/** Builds a JWT whose exp is `seconds` since the epoch; signature is arbitrary. */
const makeJwt = (seconds: number): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ exp: seconds })).toString('base64url')
  return `${header}.${body}.sig`
}

describe('create-token-refresh', () => {
  it('refreshes to obtain the first token and returns a Bearer header', async () => {
    const auth = createTokenRefresh({
      refresh: async () => ({ token: 'abc', expiresAt: 10_000 }),
      now: () => 0,
      proactive: false,
    })
    expect(await auth.headers()).toEqual({ authorization: 'Bearer abc' })
    expect(auth.token()).toEqual({ token: 'abc', expiresAt: 10_000 })
  })

  it('coalesces concurrent calls on an expired token into one refresh', async () => {
    let calls = 0
    const auth = createTokenRefresh({
      refresh: async () => {
        calls += 1
        return { token: `t${calls}`, expiresAt: 10_000 }
      },
      now: () => 0,
      proactive: false,
    })
    const results = await Promise.all([auth.headers(), auth.headers(), auth.headers()])
    // One round-trip shared by all three; every caller sees the same token.
    expect(calls).toBe(1)
    expect(results).toEqual([
      { authorization: 'Bearer t1' },
      { authorization: 'Bearer t1' },
      { authorization: 'Bearer t1' },
    ])
  })

  it('renews inside the window without blocking the current call', async () => {
    let calls = 0
    const auth = createTokenRefresh({
      initial: { token: 'old', expiresAt: 10_000 },
      refresh: async () => {
        calls += 1
        return { token: 'new', expiresAt: 20_000 }
      },
      refreshBefore: 2_000,
      now: () => 8_500, // valid (< 10_000) but inside the 2s window
      proactive: false,
    })
    // The in-window call keeps using the current token...
    expect(await auth.headers()).toEqual({ authorization: 'Bearer old' })
    // ...while a background refresh runs and swaps the token in for next time.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    expect(auth.token()).toEqual({ token: 'new', expiresAt: 20_000 })
  })

  it('does not refresh a token that is comfortably valid', async () => {
    let calls = 0
    const auth = createTokenRefresh({
      initial: { token: 'fresh', expiresAt: 10_000 },
      refresh: async () => {
        calls += 1
        return { token: 'new', expiresAt: 20_000 }
      },
      refreshBefore: 2_000,
      now: () => 1_000,
      proactive: false,
    })
    expect(await auth.headers()).toEqual({ authorization: 'Bearer fresh' })
    expect(calls).toBe(0)
  })

  it('decodes JWT expiry when refresh returns a bare token string', async () => {
    const jwt = makeJwt(10_000) // exp in seconds → 10_000_000 ms
    const auth = createTokenRefresh({
      refresh: async () => jwt,
      now: () => 0,
      proactive: false,
    })
    expect(await auth.headers()).toEqual({ authorization: `Bearer ${jwt}` })
    expect(auth.token()?.expiresAt).toBe(10_000_000)
  })

  it('uses a custom expiry extractor for opaque token strings', async () => {
    const auth = createTokenRefresh({
      refresh: async () => 'opaque-token',
      expiry: () => 5_000,
      now: () => 0,
      proactive: false,
    })
    expect(auth.token()).toBeUndefined()
    await auth.headers()
    expect(auth.token()).toEqual({ token: 'opaque-token', expiresAt: 5_000 })
  })

  it('supports a custom header shape', async () => {
    const auth = createTokenRefresh({
      refresh: async () => ({ token: 'k', expiresAt: 10_000 }),
      header: (token) => ({ 'x-api-key': token }),
      now: () => 0,
      proactive: false,
    })
    expect(await auth.headers()).toEqual({ 'x-api-key': 'k' })
  })

  it('does not cache a failed refresh and retries on the next call', async () => {
    let attempt = 0
    const auth = createTokenRefresh({
      refresh: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('boom')
        return { token: 'ok', expiresAt: 10_000 }
      },
      now: () => 0,
      proactive: false,
    })
    await expect(auth.headers()).rejects.toThrow('boom')
    expect(await auth.headers()).toEqual({ authorization: 'Bearer ok' })
    expect(attempt).toBe(2)
  })

  it('reports background refresh failures to onError instead of throwing', async () => {
    const errors: unknown[] = []
    const auth = createTokenRefresh({
      initial: { token: 'old', expiresAt: 10_000 },
      refresh: async () => {
        throw new Error('background boom')
      },
      refreshBefore: 2_000,
      now: () => 8_500,
      proactive: false,
      onError: (error) => errors.push(error),
    })
    // The in-window call succeeds on the current token; the failure is routed
    // to onError rather than surfacing at the call site.
    expect(await auth.headers()).toEqual({ authorization: 'Bearer old' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('background boom')
  })

  it('invalidate forces the next call to refresh even when the token is valid', async () => {
    let calls = 0
    const auth = createTokenRefresh({
      initial: { token: 'seed', expiresAt: 10_000 },
      refresh: async () => {
        calls += 1
        return { token: 'renewed', expiresAt: 20_000 }
      },
      refreshBefore: 2_000,
      now: () => 1_000,
      proactive: false,
    })
    expect(await auth.headers()).toEqual({ authorization: 'Bearer seed' })
    expect(calls).toBe(0)
    auth.invalidate()
    expect(await auth.headers()).toEqual({ authorization: 'Bearer renewed' })
    expect(calls).toBe(1)
  })

  it('does not resurrect a token when invalidate lands during an in-flight refresh', async () => {
    let resolveRefresh: ((token: { token: string; expiresAt: number }) => void) | undefined
    let calls = 0
    const auth = createTokenRefresh({
      initial: { token: 'old', expiresAt: 10_000 },
      refresh: () =>
        new Promise((resolve) => {
          calls += 1
          resolveRefresh = resolve
        }),
      refreshBefore: 2_000,
      now: () => 8_500, // inside the window, so headers() kicks off a background refresh
      proactive: false,
    })

    // In-window call rides the current token and starts a background refresh.
    expect(await auth.headers()).toEqual({ authorization: 'Bearer old' })
    expect(calls).toBe(1)

    // The caller invalidates (logout / post-401) while that refresh is still in flight.
    auth.invalidate()
    expect(auth.token()).toBeUndefined()

    // The in-flight refresh now resolves — it must NOT repopulate the token.
    resolveRefresh?.({ token: 'renewed', expiresAt: 20_000 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(auth.token()).toBeUndefined()

    // And the next call refreshes from scratch rather than reusing the resurrected token.
    const next = auth.headers()
    resolveRefresh?.({ token: 'brand-new', expiresAt: 20_000 })
    expect(await next).toEqual({ authorization: 'Bearer brand-new' })
    expect(calls).toBe(2)
  })

  it('proactively renews on an idle timer and stops after dispose', async () => {
    vi.useFakeTimers({ now: 0 })
    try {
      let calls = 0
      const auth = createTokenRefresh({
        initial: { token: 't0', expiresAt: 10_000 },
        refresh: async () => {
          calls += 1
          return { token: `t${calls}`, expiresAt: Date.now() + 10_000 }
        },
        refreshBefore: 2_000,
        // proactive defaults to true; no headers() call drives this.
      })
      // Window opens at expiresAt - refreshBefore = 8_000.
      await vi.advanceTimersByTimeAsync(8_000)
      expect(calls).toBe(1)
      auth.dispose()
      // No further renewals once disposed.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
