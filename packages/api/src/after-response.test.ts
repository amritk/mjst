import { describe, expect, it } from 'vitest'

import { createBackground, runAfterResponse } from './after-response'

describe('after-response', () => {
  it('runs a task detached when there is no waitUntil', async () => {
    let ran = false
    runAfterResponse(undefined, () => {
      ran = true
    })
    await Promise.resolve()
    expect(ran).toBe(true)
  })

  it('registers the task with waitUntil when the platform provides it', async () => {
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }
    let ran = false
    runAfterResponse(ctx, async () => {
      ran = true
    })
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(ran).toBe(true)
  })

  it('routes a rejected task to onError instead of crashing', async () => {
    const errors: unknown[] = []
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }
    runAfterResponse(
      ctx,
      () => {
        throw new Error('boom')
      },
      (error) => errors.push(error),
    )
    await Promise.all(pending)
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('boom')
  })

  it('createBackground binds an execution context', async () => {
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }
    let ran = false
    const { background } = createBackground(ctx)
    background(async () => {
      ran = true
    })
    await Promise.all(pending)
    expect(ran).toBe(true)
  })
})
