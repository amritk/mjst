import { describe, expect, it } from 'vitest'

import { createRequestId, getRequestId } from './create-request-id'
import type { RequestLocals } from './types'

describe('create-request-id', () => {
  it('generates an id when none is inbound and echoes it on the response', () => {
    const requestId = createRequestId({ generate: () => 'fixed-id' })
    const locals: RequestLocals = {}
    requestId.onRequest(new Request('http://localhost/'), undefined, undefined, locals)
    expect(locals['requestId']).toBe('fixed-id')

    const response = new Response(null)
    requestId.onResponse(response, new Request('http://localhost/'), locals)
    expect(response.headers.get('x-request-id')).toBe('fixed-id')
  })

  it('adopts a trusted inbound id', () => {
    const requestId = createRequestId()
    const locals: RequestLocals = {}
    requestId.onRequest(
      new Request('http://localhost/', { headers: { 'x-request-id': 'caller-123' } }),
      undefined,
      undefined,
      locals,
    )
    expect(locals['requestId']).toBe('caller-123')
  })

  it('ignores the inbound id at a trust boundary', () => {
    const requestId = createRequestId({ trustInbound: false, generate: () => 'fresh' })
    const locals: RequestLocals = {}
    requestId.onRequest(
      new Request('http://localhost/', { headers: { 'x-request-id': 'forged' } }),
      undefined,
      undefined,
      locals,
    )
    expect(locals['requestId']).toBe('fresh')
  })

  it('honors a custom header and locals key', () => {
    const requestId = createRequestId({ header: 'x-trace', localsKey: 'traceId', generate: () => 't-1' })
    const locals: RequestLocals = {}
    requestId.onRequest(new Request('http://localhost/'), undefined, undefined, locals)
    expect(locals['traceId']).toBe('t-1')
    const response = new Response(null)
    requestId.onResponse(response, new Request('http://localhost/'), locals)
    expect(response.headers.get('x-trace')).toBe('t-1')
    expect(getRequestId(locals, 'traceId')).toBe('t-1')
  })

  it('getRequestId returns undefined when the gate never ran', () => {
    expect(getRequestId(undefined)).toBeUndefined()
    expect(getRequestId({})).toBeUndefined()
  })
})
