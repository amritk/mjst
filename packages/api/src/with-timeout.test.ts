import { describe, expect, it } from 'vitest'

import { withTimeout } from './with-timeout'

describe('with-timeout', () => {
  it('returns the handler result when it settles in time', async () => {
    const handler = withTimeout<Record<string, never>, { status: number; body?: string }>(
      1000,
      async () => ({ status: 200, body: 'ok' }),
      () => ({ status: 504 }),
    )
    expect(await handler({})).toEqual({ status: 200, body: 'ok' })
  })

  it('returns the timeout reply when the handler is too slow', async () => {
    const handler = withTimeout<Record<string, never>, { status: number }>(
      5,
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 100)),
      () => ({ status: 504 }),
    )
    expect(await handler({})).toEqual({ status: 504 })
  })

  it('passes the context to the timeout reply builder', async () => {
    const handler = withTimeout<{ id: number }, { status: number; body: number }>(
      5,
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: 0 }), 100)),
      (ctx) => ({ status: 504, body: ctx.id }),
    )
    expect(await handler({ id: 7 })).toEqual({ status: 504, body: 7 })
  })

  it('propagates a synchronous handler throw', async () => {
    const handler = withTimeout(
      1000,
      () => {
        throw new Error('boom')
      },
      () => ({ status: 504 as const }),
    )
    await expect(handler({})).rejects.toThrow('boom')
  })
})
