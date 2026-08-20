import { describe, expect, it, vi } from 'vitest'

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

  it('rejects rather than crashing the timer when onTimeout throws', async () => {
    // `onTimeout` is app code running inside a timer callback, where a throw
    // has nowhere to go: on Node it is an uncaught exception, and the race it
    // was meant to settle never settles, so the request hangs as well.
    vi.useFakeTimers()
    try {
      const wrapped = withTimeout(
        10,
        () => new Promise<{ status: 504 }>(() => undefined),
        () => {
          throw new Error('could not build the timeout reply')
        },
      )
      const running = wrapped({})
      expect(() => vi.advanceTimersByTime(20)).not.toThrow()
      await expect(running).rejects.toThrow('could not build the timeout reply')
    } finally {
      vi.useRealTimers()
    }
  })
})
