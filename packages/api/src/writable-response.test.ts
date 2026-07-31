import { describe, expect, it } from 'vitest'

import { writableResponse } from './writable-response'

/**
 * The immutable case is what a `Response` out of `fetch()` looks like — a
 * proxying mount's reply. `Response.redirect`/`Response.error` are the only
 * standard constructors that produce a guarded Headers object without a
 * network round trip, so they stand in for it here.
 */
const immutable = (): Response => Response.redirect('https://example.com/elsewhere', 302)

describe('writable-response', () => {
  it('returns the same response when its headers are already mutable', () => {
    const response = new Response('hi')
    expect(writableResponse(response)).toBe(response)
  })

  it('leaves no probe header behind', () => {
    const response = new Response('hi')
    writableResponse(response)
    expect(response.headers.has('x-amritk-probe')).toBe(false)
  })

  it('clones a response whose headers are immutable', () => {
    const response = immutable()
    // Sanity check: mutating the original really does throw, which is the
    // whole reason this helper exists.
    expect(() => response.headers.set('x-added', '1')).toThrow()

    const target = writableResponse(response)
    expect(target).not.toBe(response)
    target.headers.set('x-added', '1')
    expect(target.headers.get('x-added')).toBe('1')
  })

  it('keeps status and existing headers on the clone', () => {
    const target = writableResponse(immutable())
    expect(target.status).toBe(302)
    expect(target.headers.get('location')).toBe('https://example.com/elsewhere')
  })
})
