import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { waitForDrain } from './wait-for-drain'

/**
 * A real Writable with a tiny buffer whose consumption is held until the test
 * releases it — `write` returns false immediately, and 'drain' fires only
 * after `release()` lets the pending callback run.
 */
const blockedWritable = (): { writable: Writable; release: () => void } => {
  let pending: (() => void) | undefined
  const writable = new Writable({
    highWaterMark: 1,
    write: (_chunk, _encoding, callback) => {
      pending = callback
    },
  })
  return {
    writable,
    release: () => {
      pending?.()
      pending = undefined
    },
  }
}

describe('wait-for-drain', () => {
  it('resolves true once the writable drains', async () => {
    const { writable, release } = blockedWritable()
    expect(writable.write('overflow the one-byte buffer')).toBe(false)
    const waiting = waitForDrain(writable)
    release()
    await expect(waiting).resolves.toBe(true)
  })

  it('resolves false immediately for an already destroyed writable', async () => {
    const { writable } = blockedWritable()
    writable.destroy()
    // Wait for 'close' so the destroyed/closed state is fully settled.
    await new Promise((resolve) => writable.once('close', resolve))
    await expect(waitForDrain(writable)).resolves.toBe(false)
  })

  it('resolves false instead of hanging when the writable closes mid-wait', async () => {
    const { writable } = blockedWritable()
    writable.write('overflow')
    const waiting = waitForDrain(writable)
    writable.destroy()
    await expect(waiting).resolves.toBe(false)
  })

  it('resolves false instead of hanging when the writable errors mid-wait', async () => {
    const { writable } = blockedWritable()
    writable.write('overflow')
    // Swallow the error emission so it does not become an unhandled event
    // outside the once() window.
    writable.on('error', () => undefined)
    const waiting = waitForDrain(writable)
    writable.destroy(new Error('socket reset'))
    await expect(waiting).resolves.toBe(false)
  })

  it('leaves no lingering close listeners behind', async () => {
    const { writable, release } = blockedWritable()
    const before = writable.listenerCount('close')
    writable.write('overflow')
    const waiting = waitForDrain(writable)
    release()
    await waiting
    expect(writable.listenerCount('close')).toBe(before)
  })
})
