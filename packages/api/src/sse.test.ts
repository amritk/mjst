import { describe, expect, it } from 'vitest'

import { formatSse, sseStream } from './sse'
import type { StreamingBody } from './types'

const drain = async (stream: StreamingBody): Promise<string> =>
  new Response(stream as ReadableStream<Uint8Array>).text()

describe('sse', () => {
  it('formats events into spec frames', () => {
    expect(formatSse({ data: 'hello' })).toBe('data: hello\n\n')
    expect(formatSse({ event: 'ping', id: '1', data: 'x' })).toBe('event: ping\nid: 1\ndata: x\n\n')
    expect(formatSse({ retry: 3000 })).toBe('retry: 3000\n\n')
    expect(formatSse({ comment: 'keep-alive' })).toBe(': keep-alive\n\n')
  })

  it('splits multi-line data into multiple data fields', () => {
    expect(formatSse({ data: 'a\nb' })).toBe('data: a\ndata: b\n\n')
  })

  it('streams an async generator of events', async () => {
    const stream = sseStream(
      (async function* () {
        yield { data: '1' }
        yield 'plain'
        yield { event: 'done', data: '2' }
      })(),
    )
    expect(await drain(stream)).toBe('data: 1\n\ndata: plain\n\nevent: done\ndata: 2\n\n')
  })

  it('stops when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let pulled = false
    const stream = sseStream(
      (async function* () {
        pulled = true
        yield { data: 'never' }
      })(),
      { signal: controller.signal },
    )
    expect(await drain(stream)).toBe('')
    expect(pulled).toBe(false)
  })

  it('runs the generator finally block on cancel', async () => {
    let cleaned = false
    const stream = sseStream(
      (async function* () {
        try {
          yield { data: 'first' }
          yield { data: 'second' }
        } finally {
          cleaned = true
        }
      })(),
    ) as ReadableStream<Uint8Array>
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()
    expect(cleaned).toBe(true)
  })
})
