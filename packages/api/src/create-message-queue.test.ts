import { describe, expect, it } from 'vitest'

import { createMessageQueue } from './create-message-queue'

describe('create-message-queue', () => {
  it('delivers a value pushed before the consumer asks', async () => {
    const queue = createMessageQueue<string>()
    queue.push('early')
    expect(await queue.stream.next()).toEqual({ value: 'early', done: false })
  })

  it('delivers a value pushed while the consumer waits', async () => {
    const queue = createMessageQueue<string>()
    const pending = queue.stream.next()
    queue.push('late')
    expect(await pending).toEqual({ value: 'late', done: false })
  })

  it('preserves order across a burst', async () => {
    const queue = createMessageQueue<number>()
    for (const value of [1, 2, 3]) queue.push(value)
    const seen = [await queue.stream.next(), await queue.stream.next(), await queue.stream.next()]
    expect(seen.map((result) => result.value)).toEqual([1, 2, 3])
  })

  it('drains what is buffered before reporting the end', async () => {
    // A close that races the last message must not swallow it — on a realtime
    // channel that is a lost message, not a lost log line.
    const queue = createMessageQueue<string>()
    queue.push('last')
    queue.end()
    expect(await queue.stream.next()).toEqual({ value: 'last', done: false })
    expect(await queue.stream.next()).toEqual({ value: undefined, done: true })
  })

  it('releases a parked consumer when the stream ends', async () => {
    const queue = createMessageQueue<string>()
    const pending = queue.stream.next()
    queue.end()
    expect(await pending).toEqual({ value: undefined, done: true })
  })

  it('surfaces a failure only after the buffered values', async () => {
    const queue = createMessageQueue<string>()
    queue.push('delivered')
    queue.end(new Error('stream broke'))
    expect(await queue.stream.next()).toEqual({ value: 'delivered', done: false })
    await expect(queue.stream.next()).rejects.toThrow('stream broke')
  })

  it('ignores a push after the end', async () => {
    const queue = createMessageQueue<string>()
    queue.end()
    queue.push('too late')
    expect(await queue.stream.next()).toEqual({ value: undefined, done: true })
  })

  it('ends once, so a second end does not overwrite the first outcome', async () => {
    const queue = createMessageQueue<string>()
    queue.end()
    queue.end(new Error('ignored'))
    expect(await queue.stream.next()).toEqual({ value: undefined, done: true })
  })

  it('works with for await, ending when the producer does', async () => {
    const queue = createMessageQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.end()
    const seen: number[] = []
    for await (const value of queue.stream) seen.push(value)
    expect(seen).toEqual([1, 2])
  })

  it('ends the queue when the consumer breaks out early', async () => {
    const queue = createMessageQueue<number>()
    queue.push(1)
    queue.push(2)
    for await (const value of queue.stream) {
      expect(value).toBe(1)
      break
    }
    expect(await queue.stream.next()).toEqual({ value: undefined, done: true })
  })

  it('rejects a consumer parked in for-await when the producer errors', async () => {
    // The normal shape: a loop is already awaiting when the transport fails.
    // Resolving it with `{ done: true }` reported a clean end of stream and
    // dropped the error entirely.
    const queue = createMessageQueue<string>()
    const pending = queue.stream.next()
    queue.end(new Error('transport gone'))
    await expect(pending).rejects.toThrow('transport gone')
  })

  it('still delivers buffered messages before surfacing the error', async () => {
    const queue = createMessageQueue<string>()
    queue.push('first')
    queue.end(new Error('transport gone'))
    expect(await queue.stream.next()).toEqual({ value: 'first', done: false })
    await expect(queue.stream.next()).rejects.toThrow('transport gone')
  })
})
