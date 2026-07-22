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

  it('splits data on CR and CRLF, not just LF, so a lone CR cannot forge a field', () => {
    // Without CR handling, `data: ok\rdata: {"role":"admin"}` reaches the
    // client as two data fields — the second one attacker-forged.
    expect(formatSse({ data: 'ok\rinjected' })).toBe('data: ok\ndata: injected\n\n')
    expect(formatSse({ data: 'a\r\nb' })).toBe('data: a\ndata: b\n\n')
  })

  it('strips newlines from single-line event and id fields', () => {
    // A `\n` in `event` would otherwise inject a `data:` field of its own.
    expect(formatSse({ event: 'msg\ndata: forged', data: 'x' })).toBe('event: msgdata: forged\ndata: x\n\n')
    expect(formatSse({ id: '1\revent: privileged', data: 'x' })).toBe('id: 1event: privileged\ndata: x\n\n')
  })

  it('splits a multi-line comment into repeated comment lines instead of injecting', () => {
    // Each line stays a `:` comment (ignored by clients); no `\r\r` can slip a
    // blank line through to terminate the event early.
    expect(formatSse({ comment: 'a\r\rb' })).toBe(': a\n: \n: b\n\n')
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
