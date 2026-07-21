import { describe, expect, it } from 'vitest'

import { createHealth } from './create-health'

const get = (): Request => new Request('http://localhost/healthz')

describe('create-health', () => {
  it('returns 200 ok for a bare liveness endpoint', async () => {
    const health = createHealth()
    const response = await health(get())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('reports per-probe status when all pass', async () => {
    const health = createHealth({
      checks: [
        { name: 'db', check: () => true },
        { name: 'cache', check: async () => true },
      ],
    })
    const response = await health(get())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', checks: { db: 'up', cache: 'up' } })
  })

  it('returns 503 when a probe is down', async () => {
    const health = createHealth({
      checks: [
        { name: 'db', check: () => true },
        { name: 'cache', check: () => false },
      ],
    })
    const response = await health(get())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'error', checks: { db: 'up', cache: 'down' } })
  })

  it('treats a throwing probe as down, not a crash', async () => {
    const health = createHealth({
      checks: [
        {
          name: 'flaky',
          check: () => {
            throw new Error('boom')
          },
        },
      ],
    })
    const response = await health(get())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ checks: { flaky: 'down' } })
  })

  it('merges extra info fields', async () => {
    const health = createHealth({ info: { version: '1.2.3' } })
    expect(await (await health(get())).json()).toEqual({ status: 'ok', version: '1.2.3' })
  })

  it('rejects non-GET methods', async () => {
    const health = createHealth()
    const response = await health(new Request('http://localhost/healthz', { method: 'POST' }))
    expect(response.status).toBe(405)
  })
})
