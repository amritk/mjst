import { describe, expect, it } from 'vitest'

import { createRateLimit, memoryRateLimitStore } from './create-rate-limit'
import type { RequestLocals } from './types'

const req = (headers: Record<string, string> = {}): Request => new Request('http://localhost/', { headers })

describe('create-rate-limit', () => {
  it('allows requests under the limit and stamps RateLimit headers', async () => {
    const limit = createRateLimit({ limit: 2, windowMs: 60_000, key: () => 'k' })
    const locals: RequestLocals = {}
    expect(await limit.onRequest(req(), undefined, undefined, locals)).toBeUndefined()

    const response = new Response(null)
    limit.onResponse(response, req(), locals)
    expect(response.headers.get('ratelimit-limit')).toBe('2')
    expect(response.headers.get('ratelimit-remaining')).toBe('1')
    expect(Number(response.headers.get('ratelimit-reset'))).toBeGreaterThan(0)
  })

  it('short-circuits with a 429 once the limit is exceeded', async () => {
    const limit = createRateLimit({ limit: 1, windowMs: 60_000, key: () => 'k' })
    expect(await limit.onRequest(req(), undefined, undefined, {})).toBeUndefined()

    const blocked = await limit.onRequest(req(), undefined, undefined, {})
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('retry-after')).not.toBeNull()
    expect(blocked?.headers.get('ratelimit-remaining')).toBe('0')
    expect(await blocked?.json()).toEqual({ error: 'rate_limited' })
  })

  it('keys distinct callers into separate buckets', async () => {
    let ip = 'a'
    const limit = createRateLimit({ limit: 1, windowMs: 60_000, key: () => ip })
    expect(await limit.onRequest(req(), undefined, undefined, {})).toBeUndefined()
    ip = 'b'
    expect(await limit.onRequest(req(), undefined, undefined, {})).toBeUndefined()
    ip = 'a'
    expect((await limit.onRequest(req(), undefined, undefined, {}))?.status).toBe(429)
  })

  it('derives the default key from proxy headers', async () => {
    const limit = createRateLimit({ limit: 1, windowMs: 60_000 })
    expect(
      await limit.onRequest(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }), undefined, undefined, {}),
    ).toBeUndefined()
    expect((await limit.onRequest(req({ 'x-forwarded-for': '1.1.1.1' }), undefined, undefined, {}))?.status).toBe(429)
    // A different first hop is a different bucket.
    expect(await limit.onRequest(req({ 'x-forwarded-for': '9.9.9.9' }), undefined, undefined, {})).toBeUndefined()
  })

  it('resets the window once it elapses', async () => {
    const store = memoryRateLimitStore()
    const limit = createRateLimit({ limit: 1, windowMs: 1, key: () => 'k', store })
    expect(await limit.onRequest(req(), undefined, undefined, {})).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await limit.onRequest(req(), undefined, undefined, {})).toBeUndefined()
  })

  it('bounds memory under a flood of distinct keys by evicting the oldest', async () => {
    // Simulates a distinct-key flood (e.g. spoofed x-forwarded-for values): the
    // map must not grow without bound, so oldest-inserted keys are evicted once
    // it crosses the ceiling. An evicted key's counter resets to a fresh window.
    const store = memoryRateLimitStore()
    store.hit('victim', 60_000)
    expect((await store.hit('victim', 60_000)).count).toBe(2) // still tracked at count 2
    for (let i = 0; i < 100_001; i++) store.hit(`flood-${i}`, 60_000)
    // The oldest key ('victim') has been evicted, so it starts a new window.
    expect((await store.hit('victim', 60_000)).count).toBe(1)
    // A recently-seen key is retained and keeps counting.
    expect((await store.hit('flood-100000', 60_000)).count).toBe(2)
  })

  it('supports a custom 429 body', async () => {
    const limit = createRateLimit({
      limit: 0,
      windowMs: 60_000,
      key: () => 'k',
      response: (retryAfter) => JSON.stringify({ error: 'slow down', retryAfter }),
    })
    const blocked = await limit.onRequest(req(), undefined, undefined, {})
    expect(blocked?.status).toBe(429)
    expect(await blocked?.json()).toMatchObject({ error: 'slow down' })
  })
})
